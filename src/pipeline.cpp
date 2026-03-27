#include "pipeline.h"
#include <iostream>
#include <sstream>
#include <unordered_map>

Pipeline::Pipeline(Cache& cache,
                   SessionState& session,
                   IntentResolver& resolver,
                   ApiFetch& fetcher,
                   DedupGate& dedup,
                   Output& output,
                   bool offlineMode,
                   int windowSize,
                   int debounceMs)
    : cache_(cache)
    , session_(session)
    , resolver_(resolver)
    , fetcher_(fetcher)
    , dedup_(dedup)
    , output_(output)
    , offline_mode_(offlineMode)
    , window_size_(windowSize)
    , debounce_ms_(debounceMs)
    , last_intent_call_(std::chrono::steady_clock::now() - std::chrono::seconds(10))
{
    // Start the worker thread for async intent resolution.
    worker_ = std::thread(&Pipeline::workerLoop, this);
}

Pipeline::~Pipeline() {
    stop();
}

void Pipeline::stop() {
    bool expected = true;
    if (!running_.compare_exchange_strong(expected, false)) return;
    work_cv_.notify_all();
    if (worker_.joinable()) worker_.join();
}

void Pipeline::workerLoop() {
    while (running_) {
        std::string text;
        {
            std::unique_lock<std::mutex> lock(work_mutex_);
            work_cv_.wait(lock, [&]() {
                return !work_queue_.empty() || !running_;
            });
            if (!running_) break;
            text = std::move(work_queue_.front());
            work_queue_.pop();
        }
        processWindow(text);
        {
            std::lock_guard<std::mutex> lock(mutex_);
            last_intent_call_ = std::chrono::steady_clock::now();
        }
    }
}

void Pipeline::onToken(const std::string& token) {
    // Single-word variant — just adds to window without firing.
    std::lock_guard<std::mutex> lock(mutex_);
    window_.push_back(token);
    while (static_cast<int>(window_.size()) > window_size_) {
        window_.pop_front();
    }
}

void Pipeline::onSegment(const std::string& segmentText) {
    // Tokenize the segment and add ALL words to window under one lock,
    // then decide whether to fire. This ensures "Isaiah 521" lands
    // together before any intent resolution.
    std::string textSnapshot;

    {
        std::lock_guard<std::mutex> lock(mutex_);

        std::istringstream iss(segmentText);
        std::string word;
        while (iss >> word) {
            window_.push_back(word);
        }
        while (static_cast<int>(window_.size()) > window_size_) {
            window_.pop_front();
        }

        if (window_.size() < 2) return;

        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_intent_call_).count();
        if (elapsed < debounce_ms_) return;

        last_intent_call_ = now;

        // Snapshot window text under lock.
        std::ostringstream oss;
        bool first = true;
        for (const auto& w : window_) {
            if (!first) oss << " ";
            oss << w;
            first = false;
        }
        textSnapshot = oss.str();
    }

    // Queue for async processing on worker thread.
    // Replace any pending unprocessed snapshot so the worker always gets
    // the latest window — prevents verse references from scrolling past.
    {
        std::lock_guard<std::mutex> lock(work_mutex_);
        std::queue<std::string> empty;
        std::swap(work_queue_, empty);
        work_queue_.push(std::move(textSnapshot));
    }
    work_cv_.notify_one();
}

std::string Pipeline::getWindowText() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::ostringstream oss;
    bool first = true;
    for (const auto& w : window_) {
        if (!first) oss << " ";
        oss << w;
        first = false;
    }
    return oss.str();
}

void Pipeline::clearWindow() {
    std::lock_guard<std::mutex> lock(mutex_);
    window_.clear();
}

void Pipeline::processWindow(const std::string& text) {
    if (!running_) return;

    std::cerr << "[pipeline] Window: \"" << text << "\"\n";

    std::string activeTrans = session_.getActiveTranslation();

    // ── Step 1: Try shortcuts (no LLM call needed) ──────
    auto shortcut = context_.tryShortcut(text, activeTrans);
    if (shortcut.has_value() && shortcut->valid) {
        auto norm = BookNormalizer::normalize(shortcut->book);
        if (norm.has_value()) shortcut->book = norm.value();
        emitVerse(shortcut.value());
        return;
    }

    // ── Step 2: Resolve intent ──────────────────────────────
    // ALWAYS try local regex first (instant, <1ms).
    // Only fall back to LLM if regex finds nothing and we're online.
    ConversationContext ctx = context_.getContext();
    std::string contextJson = ctx.toJson();

    IntentResult result = localResolver_.resolve(text, contextJson);

    if (result.intent != Intent::NONE && result.confidence >= 0.75f) {
        // High-confidence local match — use it directly.
        std::cerr << "[local] ";
    } else if (!offline_mode_) {
        // No match, or low-confidence — try LLM.
        // LLM handles garbled translations ("Ani-l-t-vashon" → "NLT version"),
        // ambiguous references, and complex patterns.
        IntentResult localBackup = result;
        result = resolver_.resolve(text, contextJson);

        // If Groq failed (confidence 0 = API error / empty response),
        // fall back to the local result rather than discarding it.
        if (result.intent == Intent::NONE && result.confidence == 0.0f &&
            localBackup.intent != Intent::NONE && localBackup.confidence >= 0.6f) {
            result = localBackup;
            std::cerr << "[local-fallback] ";
        } else {
            std::cerr << "[online] ";
        }
    } else if (result.intent != Intent::NONE && result.confidence >= 0.6f) {
        // Offline + medium confidence — use it but log warning.
        std::cerr << "[offline-low] ";
    } else {
        std::cerr << "[offline] ";
        result = IntentResult{}; // Force IGNORE for very low confidence.
    }

    std::cerr << "[pipeline] Intent: "
              << (result.intent == Intent::SHOW_VERSE ? "SHOW_VERSE" :
                  result.intent == Intent::CHANGE_TRANSLATION ? "CHANGE_TRANSLATION" : "NONE")
              << " (confidence: " << result.confidence << ")\n";

    switch (result.intent) {
        case Intent::SHOW_VERSE: {
            // ── Step 3: Context resolution (merge partial with context) ──
            ResolvedReference ref = context_.resolve(result, activeTrans);

            if (!ref.valid) {
                std::cerr << "[pipeline] Incomplete reference after context resolution, skipping\n";
                return;
            }

            // Normalize book name (safety net for LLM garbles).
            auto norm = BookNormalizer::normalize(ref.book);
            if (norm.has_value()) {
                if (norm.value() != ref.book) {
                    std::cerr << "[pipeline] Book corrected: \"" << ref.book
                              << "\" → \"" << norm.value() << "\"\n";
                }
                ref.book = norm.value();
            } else {
                std::cerr << "[pipeline] Unknown book: \"" << ref.book << "\", skipping\n";
                return;
            }

            emitVerse(ref);
            break;
        }
        case Intent::CHANGE_TRANSLATION: {
            if (!result.translation.has_value() || result.translation->empty()) {
                std::cerr << "[pipeline] No translation code, skipping\n";
                return;
            }
            std::string newTrans = result.translation.value();
            bool applied = session_.setPastorTranslation(newTrans);
            if (applied) {
                std::cerr << "[pipeline] Translation changed to: " << newTrans << "\n";
                // Emit translation change event to stdout for the UI.
                nlohmann::json event;
                event["event"] = "translation_change";
                event["translation"] = newTrans;
                std::cout << event.dump() << std::endl;
                clearWindow();
            } else {
                std::cerr << "[pipeline] Translation change to " << newTrans
                          << " ignored (operator locked)\n";
            }
            break;
        }
        case Intent::NONE:
            break;
    }
}

void Pipeline::emitVerse(const ResolvedReference& ref) {
    std::string refStr = formatReference(ref.book, ref.chapter, ref.verse);
    std::string activeTrans = ref.translation;

    // Dedup gate.
    if (dedup_.isDuplicate(refStr, activeTrans)) {
        std::cerr << "[pipeline] Duplicate suppressed: " << refStr << " (" << activeTrans << ")\n";
        return;
    }

    // Cache lookup.
    auto verse = cache_.lookup(activeTrans, ref.book, ref.chapter, ref.verse);

    if (!verse.has_value()) {
        // Cache miss — fetch entire chapter.
        auto fetchResult = fetcher_.fetchChapter(activeTrans, ref.book, ref.chapter);
        if (fetchResult.success) {
            cache_.storeChapter(activeTrans, ref.book, ref.chapter, fetchResult.verses);
            verse = cache_.lookup(activeTrans, ref.book, ref.chapter, ref.verse);
        }

        if (!verse.has_value()) {
            // Fallback: try default translation.
            std::string defaultTrans = session_.getDefaultTranslation();
            if (defaultTrans != activeTrans) {
                verse = cache_.lookup(defaultTrans, ref.book, ref.chapter, ref.verse);
                if (verse.has_value()) {
                    std::cerr << "[pipeline] Fallback: serving in " << defaultTrans << "\n";
                    activeTrans = defaultTrans;
                }
            }
        }

        if (!verse.has_value()) {
            VerseOutput out;
            out.text = "[verse text unavailable]";
            out.reference = refStr;
            out.active = activeTrans;
            out.defaultTrans = session_.getDefaultTranslation();
            out.copyright = getCopyrightNotice(activeTrans);
            output_.emit(out);
            // Still update context — the reference was valid.
            context_.update(const_cast<ResolvedReference&>(ref));
            clearWindow();
            return;
        }
    }

    // Emit.
    VerseOutput out;
    out.text = verse->text;
    out.reference = refStr;
    out.active = activeTrans;
    out.defaultTrans = session_.getDefaultTranslation();
    out.copyright = getCopyrightNotice(activeTrans);
    output_.emit(out);

    // Update conversation context.
    context_.update(const_cast<ResolvedReference&>(ref));
    clearWindow();
}

std::string Pipeline::formatReference(const std::string& book, int chapter, int verse) {
    return book + " " + std::to_string(chapter) + ":" + std::to_string(verse);
}

std::string Pipeline::getCopyrightNotice(const std::string& translation) {
    static const std::unordered_map<std::string, std::string> notices = {
        {"KJV", "Public Domain"},
        {"NIV", "Copyright \u00A9 1973, 1978, 1984, 2011 by Biblica, Inc."},
        {"NLT", "Copyright \u00A9 1996, 2004, 2007, 2013, 2015 by Tyndale House Foundation."},
        {"AMP", "Copyright \u00A9 2015 by The Lockman Foundation."},
        {"AMPC", "Copyright \u00A9 1954, 1958, 1962, 1964, 1965, 1987 by The Lockman Foundation."},
        {"NKJV", "Copyright \u00A9 1982 by Thomas Nelson."},
        {"MSG", "Copyright \u00A9 1993, 2002. Used by permission of NavPress Publishing Group."},
        {"TPT", "Copyright \u00A9 2017, 2018, 2020 by Passion & Fire Ministries, Inc."},
        {"ESV", "Copyright \u00A9 2001 by Crossway Bibles."},
        {"NASB", "Copyright by The Lockman Foundation."}
    };

    auto it = notices.find(translation);
    return it != notices.end() ? it->second : "";
}
