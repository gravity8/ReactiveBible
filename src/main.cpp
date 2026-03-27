#include "cache.h"
#include "session_state.h"
#include "intent_resolver.h"
#include "api_fetch.h"
#include "dedup.h"
#include "output.h"
#include "pipeline.h"

#include <nlohmann/json.hpp>
#include <whisper.h>
#include <curl/curl.h>

#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <csignal>
#include <atomic>
#include <cstring>
#include <cmath>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>

static std::atomic<bool> g_running{true};

static void signalHandler(int) {
    g_running = false;
}

struct Config {
    std::string mode = "offline"; // "online" or "offline"
    std::string default_translation = "KJV";
    std::vector<std::string> l1_translations;
    std::unordered_map<std::string, std::string> api_bible_keys;
    std::string groq_api_key;
    std::string disk_cache_path = "./bible_cache/";
    std::string kjv_path = "./bibles/kjv.json";
    std::string whisper_model_path = "./models/ggml-base.en.bin";
    int dedup_window_seconds = 8;
    int sliding_window_size = 10;
    int debounce_ms = 150;
};

static Config loadConfig(const std::string& path) {
    Config cfg;

    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "[main] Warning: config.json not found, using defaults\n";
        return cfg;
    }

    try {
        nlohmann::json j;
        file >> j;

        if (j.contains("mode"))
            cfg.mode = j["mode"].get<std::string>();
        if (j.contains("default_translation"))
            cfg.default_translation = j["default_translation"].get<std::string>();
        if (j.contains("l1_translations"))
            cfg.l1_translations = j["l1_translations"].get<std::vector<std::string>>();
        if (j.contains("api_bible_accounts") && j["api_bible_accounts"].is_array()) {
            for (const auto& account : j["api_bible_accounts"]) {
                // Try inline "key" first, then "env_key" for env var lookup.
                std::string key = account.value("key", "");
                if (key.empty() && account.contains("env_key")) {
                    const char* envVal = std::getenv(account["env_key"].get<std::string>().c_str());
                    if (envVal) key = envVal;
                }
                if (key.empty()) continue;
                if (account.contains("translations") && account["translations"].is_array()) {
                    for (const auto& trans : account["translations"]) {
                        cfg.api_bible_keys[trans.get<std::string>()] = key;
                    }
                }
            }
        }
        // Backwards compat: single api_bible_key applies to all L1 translations.
        if (cfg.api_bible_keys.empty() && j.contains("api_bible_key")) {
            std::string key = j["api_bible_key"].get<std::string>();
            for (const auto& trans : cfg.l1_translations) {
                cfg.api_bible_keys[trans] = key;
            }
        }
        // Groq API key: prefer env var, fall back to config file.
        {
            const char* groqEnv = std::getenv("GROQ_API_KEY");
            if (groqEnv && groqEnv[0] != '\0') {
                cfg.groq_api_key = groqEnv;
            } else if (j.contains("groq_api_key")) {
                cfg.groq_api_key = j["groq_api_key"].get<std::string>();
            }
        }
        if (j.contains("disk_cache_path"))
            cfg.disk_cache_path = j["disk_cache_path"].get<std::string>();
        // Environment override for writable cache dir (set by Electron in packaged mode).
        if (const char* env_cache = std::getenv("BIBLE_CACHE_DIR"))
            cfg.disk_cache_path = std::string(env_cache) + "/";
        if (j.contains("kjv_path"))
            cfg.kjv_path = j["kjv_path"].get<std::string>();
        if (j.contains("whisper_model_path"))
            cfg.whisper_model_path = j["whisper_model_path"].get<std::string>();
        if (j.contains("dedup_window_seconds"))
            cfg.dedup_window_seconds = j["dedup_window_seconds"].get<int>();
        if (j.contains("sliding_window_size"))
            cfg.sliding_window_size = j["sliding_window_size"].get<int>();
        if (j.contains("debounce_ms"))
            cfg.debounce_ms = j["debounce_ms"].get<int>();
    } catch (const std::exception& e) {
        std::cerr << "[main] Config parse error: " << e.what() << "\n";
    }

    return cfg;
}

// Whisper audio callback — called with new audio segments.
struct WhisperCallbackData {
    Pipeline* pipeline;
};

int main(int argc, char* argv[]) {
    // Initialize curl globally (thread-safe init before any curl calls).
    curl_global_init(CURL_GLOBAL_DEFAULT);

    // Signal handling for graceful shutdown.
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    std::string configPath = "config.json";
    if (argc > 1) {
        configPath = argv[1];
    }

    // ── Step 1: Read config ─────────────────────────────────
    std::cerr << "[main] Loading config from: " << configPath << "\n";
    Config cfg = loadConfig(configPath);

    std::cerr << "[main] Default translation: " << cfg.default_translation << "\n";
    std::cerr << "[main] L1 translations: " << cfg.l1_translations.size() << "\n";

    // ── Step 2: Load L1 translations into cache ─────────────
    Cache cache;

    // Load all L1 translations from bundled /bibles/ directory.
    // Each translation is a JSON file: bibles/kjv.json, bibles/nlt.json, etc.
    std::string biblesDir = "./bibles/";
    for (const auto& trans : cfg.l1_translations) {
        // Try bundled file first (e.g., bibles/nlt.json)
        std::string lower;
        for (char c : trans) lower += std::tolower(static_cast<unsigned char>(c));
        std::string bundledPath = biblesDir + lower + ".json";

        if (cache.loadTranslation(trans, bundledPath)) {
            // Loaded from bundle.
        } else if (cache.loadFromDiskCache(trans, cfg.disk_cache_path)) {
            // Loaded from disk cache.
        } else {
            std::cerr << "[main] " << trans << " not available — will fetch on demand\n";
        }
    }

    // ── Step 3: Initialize session state ────────────────────
    SessionState session(cfg.default_translation);
    std::cerr << "[main] Session state initialized. Active: "
              << session.getActiveTranslation() << "\n";

    // ── Step 4: Initialize modules ──────────────────────────
    bool offlineMode = (cfg.mode == "offline");
    std::cerr << "[main] Mode: " << (offlineMode ? "OFFLINE (local regex)" : "ONLINE (Groq LLM)") << "\n";

    IntentResolver resolver(cfg.groq_api_key);
    ApiFetch fetcher;
    DedupGate dedup(cfg.dedup_window_seconds);
    Output output;

    Pipeline pipeline(cache, session, resolver, fetcher, dedup, output,
                      offlineMode, cfg.sliding_window_size, cfg.debounce_ms);

    // ── Step 5: Initialize Whisper.cpp ──────────────────────
    std::cerr << "[main] Loading Whisper model: " << cfg.whisper_model_path << "\n";

    struct whisper_context_params cparams = whisper_context_default_params();
    struct whisper_context* wctx = whisper_init_from_file_with_params(
        cfg.whisper_model_path.c_str(), cparams);

    if (!wctx) {
        std::cerr << "[main] ERROR: Failed to load Whisper model from: "
                  << cfg.whisper_model_path << "\n";
        std::cerr << "[main] Download a model with:\n";
        std::cerr << "  mkdir -p models && cd models\n";
        std::cerr << "  curl -LO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin\n";
        return 1;
    }

    std::cerr << "[main] Whisper model loaded successfully\n";

    // ── Step 6: Audio capture + streaming ───────────────────
    // Set up Whisper full params for streaming.
    struct whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wparams.print_progress   = false;
    wparams.print_special    = false;
    wparams.print_realtime   = false;
    wparams.print_timestamps = false;
    wparams.single_segment   = true;
    wparams.no_context       = true;
    wparams.language         = "en";
    wparams.suppress_blank   = true;
    wparams.suppress_nst     = true;

    // Whisper initial_prompt: biases decoder towards Bible verse patterns.
    // Heavy on "verse N" patterns so Whisper learns to hear verse numbers.
    static const char* biblePrompt =
        "Verse 35, verse 34, verse 12, verse 4. "
        "Colossians chapter 3 verse 15, go to Romans 15:4, "
        "John 13:35, Ephesians 4:32, Hebrews 2:14, "
        "Genesis 15:1, Habakkuk 2:1, Nehemiah 8:10, "
        "open your Bible to Isaiah 53:1, next verse, "
        "Amplified Classic, New Living Translation.";
    wparams.initial_prompt = biblePrompt;

    // ── Streaming audio parameters ─────────────────────────
    // Continuously buffers audio. Runs Whisper every step_ms with overlap
    // from the previous iteration for word boundary continuity.
    const int step_ms   = 1500;  // Run inference every 1.5s
    const int length_ms = 6000;  // 6s of audio context per call
    const int keep_ms   = 200;   // 200ms overlap for word boundaries

    const int sampleRate = WHISPER_SAMPLE_RATE; // 16000
    const int n_samples_keep = (keep_ms * sampleRate) / 1000;   // 3200
    const int n_samples_len  = (length_ms * sampleRate) / 1000; // 96000

    // Shared audio buffer — reader thread appends, processing loop consumes.
    std::mutex audioMutex;
    std::vector<float> audioBuffer;
    std::vector<float> audioOld; // Previous iteration's audio for overlap

    std::cerr << "[main] Streaming mode: step=" << step_ms << "ms, context="
              << length_ms << "ms, overlap=" << keep_ms << "ms\n";
    std::cerr << "[main] Ready. Reading audio from stdin (16kHz, mono, float32le)...\n";
    std::cerr << "────────────────────────────────────────────────────\n";

    // ── Audio reader thread ─────────────────────────────────
    // Continuously reads small blocks from stdin into shared buffer.
    std::thread readerThread([&]() {
        const int readSize = 1024; // ~64ms at 16kHz
        std::vector<float> readBuf(readSize);

        while (g_running) {
            size_t samplesRead = fread(readBuf.data(), sizeof(float),
                                        readSize, stdin);

            if (samplesRead == 0) {
                if (feof(stdin)) {
                    std::cerr << "[reader] End of audio input\n";
                    g_running = false;
                    break;
                }
                continue;
            }

            {
                std::lock_guard<std::mutex> lock(audioMutex);
                audioBuffer.insert(audioBuffer.end(),
                                   readBuf.begin(), readBuf.begin() + samplesRead);
                // Cap buffer at 30s to prevent unbounded growth.
                const size_t maxSamples = sampleRate * 30;
                if (audioBuffer.size() > maxSamples) {
                    audioBuffer.erase(audioBuffer.begin(),
                                      audioBuffer.begin() + (audioBuffer.size() - maxSamples));
                }
            }
        }
    });

    // ── Processing loop (streaming) ─────────────────────────
    // Wakes every step_ms, grabs accumulated audio, prepends overlap,
    // runs Whisper inference on the combined buffer.
    while (g_running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(step_ms));
        if (!g_running) break;

        // Grab new audio from shared buffer.
        std::vector<float> pcmf32_new;
        {
            std::lock_guard<std::mutex> lock(audioMutex);
            pcmf32_new = std::move(audioBuffer);
            audioBuffer.clear();
        }

        if (pcmf32_new.empty()) continue;

        // Build inference buffer: [overlap from previous] + [new audio]
        const int n_samples_new = static_cast<int>(pcmf32_new.size());
        const int n_samples_take = std::min(
            static_cast<int>(audioOld.size()),
            std::max(0, n_samples_keep + n_samples_len - n_samples_new));

        std::vector<float> pcmf32(n_samples_take + n_samples_new);

        // Copy overlap from end of previous iteration.
        if (n_samples_take > 0) {
            std::memcpy(pcmf32.data(),
                        audioOld.data() + audioOld.size() - n_samples_take,
                        n_samples_take * sizeof(float));
        }
        // Append new audio.
        std::memcpy(pcmf32.data() + n_samples_take,
                     pcmf32_new.data(), n_samples_new * sizeof(float));

        // Save for next iteration's overlap.
        audioOld = pcmf32;

        // ── Silence detection ─────────────────────────────────
        // Check RMS of new audio only (not overlap).
        float sumSq = 0.0f;
        for (int i = 0; i < n_samples_new; i++) {
            sumSq += pcmf32_new[i] * pcmf32_new[i];
        }
        float rms = std::sqrt(sumSq / static_cast<float>(n_samples_new));

        if (rms < 0.01f) {
            continue;
        }

        // Run Whisper inference on full buffer (overlap + new).
        int ret = whisper_full(wctx, wparams, pcmf32.data(), static_cast<int>(pcmf32.size()));
        if (ret != 0) {
            std::cerr << "[main] Whisper inference error: " << ret << "\n";
            continue;
        }

        // Extract text segments and feed to pipeline.
        int nSegments = whisper_full_n_segments(wctx);
        for (int i = 0; i < nSegments; i++) {
            const char* segText = whisper_full_get_segment_text(wctx, i);
            if (!segText) continue;

            std::string text(segText);
            if (text.find_first_not_of(" \t\n\r") == std::string::npos) continue;

            // Skip Whisper special tokens and non-speech segments.
            if (text.find("BLANK_AUDIO") != std::string::npos) continue;
            if (text.find('[') != std::string::npos) continue;
            if (!text.empty() && text.find('(') != std::string::npos &&
                text.find(')') != std::string::npos) continue;

            // Skip prompt echoes — Whisper sometimes repeats the initial_prompt.
            if (text.find("open your Bible") != std::string::npos ||
                text.find("Amplified Classic") != std::string::npos ||
                text.find("New Living Translation") != std::string::npos) {
                std::string trimmed = text;
                auto s = trimmed.find_first_not_of(" \t\n\r");
                auto e = trimmed.find_last_not_of(" \t\n\r");
                if (s != std::string::npos) trimmed = trimmed.substr(s, e - s + 1);
                if (trimmed.find("Colossians chapter 3") != std::string::npos ||
                    trimmed.find("go to Romans 15") != std::string::npos ||
                    trimmed.find("Genesis 15:1") != std::string::npos) {
                    std::cerr << "[whisper] Prompt echo filtered\n";
                    continue;
                }
            }

            // ── Hallucination filter ─────────────────────────
            {
                std::istringstream checkStream(text);
                std::string w, prevWord;
                int repeatCount = 0;
                bool isHallucination = false;
                while (checkStream >> w) {
                    if (w == prevWord) {
                        repeatCount++;
                        if (repeatCount >= 3) {
                            isHallucination = true;
                            break;
                        }
                    } else {
                        repeatCount = 1;
                    }
                    prevWord = w;
                }
                if (isHallucination) {
                    std::cerr << "[whisper] Hallucination filtered: \"" << text << "\"\n";
                    continue;
                }
            }

            // ── YouTube/podcast hallucination filter ─────────
            {
                std::string lower;
                for (char c : text) lower += std::tolower(static_cast<unsigned char>(c));
                if (lower.find("see you in the next") != std::string::npos ||
                    lower.find("thanks for watching") != std::string::npos ||
                    lower.find("subscribe") != std::string::npos ||
                    lower.find("like and share") != std::string::npos ||
                    lower.find("click the bell") != std::string::npos ||
                    lower.find("don't forget to") != std::string::npos ||
                    lower.find("see you next time") != std::string::npos ||
                    lower.find("thank you for listening") != std::string::npos ||
                    lower.find("we'll be right back") != std::string::npos ||
                    lower.find("in the next video") != std::string::npos ||
                    lower.find("in the next episode") != std::string::npos) {
                    std::cerr << "[whisper] YouTube hallucination filtered: \"" << text << "\"\n";
                    continue;
                }
            }

            // Skip if text is too long for the audio context (likely hallucination).
            if (text.size() > 600) {
                std::cerr << "[whisper] Oversized output filtered (" << text.size() << " chars)\n";
                continue;
            }

            std::cerr << "[whisper] \"" << text << "\"\n";

            // Feed entire segment to pipeline at once.
            auto s = text.find_first_not_of(" \t\n\r");
            auto e = text.find_last_not_of(" \t\n\r");
            if (s != std::string::npos) {
                std::string cleaned = text.substr(s, e - s + 1);
                pipeline.onSegment(cleaned);
            }
        }
    }

    // ── Cleanup ─────────────────────────────────────────────
    std::cerr << "[main] Shutting down...\n";
    g_running = false;
    pipeline.stop();
    if (readerThread.joinable()) readerThread.join();
    whisper_free(wctx);
    curl_global_cleanup();

    std::cerr << "[main] Done.\n";
    return 0;
}
