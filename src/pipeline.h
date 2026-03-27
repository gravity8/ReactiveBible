#pragma once

#include "cache.h"
#include "session_state.h"
#include "intent_resolver.h"
#include "local_intent_resolver.h"
#include "api_fetch.h"
#include "dedup.h"
#include "output.h"
#include "book_normalizer.h"
#include "context_resolver.h"

#include <string>
#include <deque>
#include <queue>
#include <chrono>
#include <mutex>
#include <atomic>
#include <thread>
#include <condition_variable>

class Pipeline {
public:
    Pipeline(Cache& cache,
             SessionState& session,
             IntentResolver& resolver,
             ApiFetch& fetcher,
             DedupGate& dedup,
             Output& output,
             bool offlineMode = false,
             int windowSize = 10,
             int debounceMs = 150);

    ~Pipeline();

    void onToken(const std::string& token);
    void onSegment(const std::string& segmentText);
    std::string getWindowText() const;
    void stop();

private:
    Cache& cache_;
    SessionState& session_;
    IntentResolver& resolver_;       // Online (Groq)
    LocalIntentResolver localResolver_; // Offline (regex)
    ApiFetch& fetcher_;
    DedupGate& dedup_;
    Output& output_;
    ContextResolver context_;
    bool offline_mode_;

    int window_size_;
    int debounce_ms_;

    mutable std::mutex mutex_;
    std::deque<std::string> window_;
    std::chrono::steady_clock::time_point last_intent_call_;

    std::atomic<bool> processing_{false};
    std::atomic<bool> running_{true};

    // Worker thread for async intent resolution (replaces detached threads).
    std::thread worker_;
    std::queue<std::string> work_queue_;
    std::mutex work_mutex_;
    std::condition_variable work_cv_;
    void workerLoop();

    void processWindow(const std::string& windowText);
    void clearWindow();
    void emitVerse(const ResolvedReference& ref);
    std::string getCopyrightNotice(const std::string& translation);
    static std::string formatReference(const std::string& book, int chapter, int verse);
};
