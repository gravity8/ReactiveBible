// Batch transcription tool for pastor profile calibration.
// Usage: whisper-transcriber <model-path> <audio-file>
// Reads a WAV/raw audio file, runs Whisper inference, prints text to stdout.

#include <whisper.h>
#include <iostream>
#include <fstream>
#include <vector>
#include <cstring>

static const char* biblePrompt =
    "Verse 35, verse 34, verse 12, verse 4. "
    "Colossians chapter 3 verse 15, go to Romans 15:4, "
    "John 13:35, Ephesians 4:32, Hebrews 2:14, "
    "Genesis 15:1, Habakkuk 2:1, Nehemiah 8:10, "
    "open your Bible to Isaiah 53:1, next verse, "
    "Amplified Classic, New Living Translation.";

// Read a WAV file and return the float samples (16kHz mono).
// Supports standard PCM WAV. Returns empty on failure.
static std::vector<float> readWav(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) return {};

    // Read WAV header.
    char riff[4];
    file.read(riff, 4);
    if (std::strncmp(riff, "RIFF", 4) != 0) {
        std::cerr << "[transcriber] Not a WAV file\n";
        return {};
    }

    file.seekg(4, std::ios::cur); // skip file size
    char wave[4];
    file.read(wave, 4);
    if (std::strncmp(wave, "WAVE", 4) != 0) {
        std::cerr << "[transcriber] Not a WAVE file\n";
        return {};
    }

    // Find 'fmt ' and 'data' chunks.
    int16_t audioFormat = 0, numChannels = 0, bitsPerSample = 0;
    int32_t sampleRate = 0;
    int32_t dataSize = 0;
    bool foundFmt = false, foundData = false;

    while (file.good() && !(foundFmt && foundData)) {
        char chunkId[4];
        int32_t chunkSize;
        file.read(chunkId, 4);
        file.read(reinterpret_cast<char*>(&chunkSize), 4);
        if (!file.good()) break;

        if (std::strncmp(chunkId, "fmt ", 4) == 0) {
            file.read(reinterpret_cast<char*>(&audioFormat), 2);
            file.read(reinterpret_cast<char*>(&numChannels), 2);
            file.read(reinterpret_cast<char*>(&sampleRate), 4);
            file.seekg(6, std::ios::cur); // skip byte rate + block align
            file.read(reinterpret_cast<char*>(&bitsPerSample), 2);
            if (chunkSize > 16) file.seekg(chunkSize - 16, std::ios::cur);
            foundFmt = true;
        } else if (std::strncmp(chunkId, "data", 4) == 0) {
            dataSize = chunkSize;
            foundData = true;
        } else {
            file.seekg(chunkSize, std::ios::cur);
        }
    }

    if (!foundFmt || !foundData || audioFormat != 1) {
        std::cerr << "[transcriber] Unsupported WAV format (need PCM)\n";
        return {};
    }

    // Read raw PCM data.
    if (dataSize <= 0 || dataSize > 500 * 1024 * 1024) { // sanity: max 500MB
        std::cerr << "[transcriber] Invalid data size: " << dataSize << "\n";
        return {};
    }
    std::vector<char> raw(dataSize);
    file.read(raw.data(), dataSize);
    if (!file.good() && !file.eof()) {
        std::cerr << "[transcriber] Failed to read PCM data\n";
        return {};
    }

    // Convert to float samples.
    std::vector<float> samples;
    if (bitsPerSample == 16) {
        int numSamples = dataSize / (2 * numChannels);
        samples.resize(numSamples);
        const int16_t* pcm = reinterpret_cast<const int16_t*>(raw.data());
        for (int i = 0; i < numSamples; i++) {
            // Take first channel if stereo.
            samples[i] = static_cast<float>(pcm[i * numChannels]) / 32768.0f;
        }
    } else if (bitsPerSample == 32) {
        int numSamples = dataSize / (4 * numChannels);
        samples.resize(numSamples);
        const float* fdata = reinterpret_cast<const float*>(raw.data());
        for (int i = 0; i < numSamples; i++) {
            samples[i] = fdata[i * numChannels];
        }
    } else {
        std::cerr << "[transcriber] Unsupported bit depth: " << bitsPerSample << "\n";
        return {};
    }

    std::cerr << "[transcriber] Loaded " << samples.size() << " samples ("
              << sampleRate << "Hz, " << numChannels << "ch, " << bitsPerSample << "bit)\n";

    return samples;
}

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: whisper-transcriber <model-path> <audio-file.wav>\n";
        return 1;
    }

    const std::string modelPath = argv[1];
    const std::string audioPath = argv[2];

    // Load audio.
    std::cerr << "[transcriber] Loading audio: " << audioPath << "\n";
    auto samples = readWav(audioPath);
    if (samples.empty()) {
        std::cerr << "[transcriber] Failed to load audio\n";
        return 1;
    }

    // Load Whisper model.
    std::cerr << "[transcriber] Loading model: " << modelPath << "\n";
    struct whisper_context_params cparams = whisper_context_default_params();
    struct whisper_context* ctx = whisper_init_from_file_with_params(modelPath.c_str(), cparams);
    if (!ctx) {
        std::cerr << "[transcriber] Failed to load Whisper model\n";
        return 1;
    }

    // Run inference.
    struct whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wparams.print_progress   = false;
    wparams.print_special    = false;
    wparams.print_realtime   = false;
    wparams.print_timestamps = false;
    wparams.language         = "en";
    wparams.suppress_blank   = true;
    wparams.suppress_nst     = true;
    wparams.initial_prompt   = biblePrompt;

    std::cerr << "[transcriber] Running inference on " << samples.size() << " samples...\n";

    if (whisper_full(ctx, wparams, samples.data(), static_cast<int>(samples.size())) != 0) {
        std::cerr << "[transcriber] Whisper inference failed\n";
        whisper_free(ctx);
        return 1;
    }

    // Collect all segments and print to stdout.
    int numSegments = whisper_full_n_segments(ctx);
    std::cerr << "[transcriber] Got " << numSegments << " segments\n";

    for (int i = 0; i < numSegments; i++) {
        const char* text = whisper_full_get_segment_text(ctx, i);
        if (text) {
            std::cout << text;
        }
    }
    std::cout << std::endl;

    whisper_free(ctx);
    return 0;
}
