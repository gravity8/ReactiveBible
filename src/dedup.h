#pragma once

#include <string>
#include <unordered_map>
#include <chrono>
#include <mutex>

class DedupGate {
public:
    explicit DedupGate(int windowSeconds = 8);

    // Returns true if this reference+translation should be suppressed.
    // If not suppressed, records it for future dedup checks.
    bool isDuplicate(const std::string& reference, const std::string& translation);

    // Clear all tracked entries.
    void clear();

private:
    int window_seconds_;
    mutable std::mutex mutex_;

    // Key: "reference|translation", Value: last emit time
    std::unordered_map<std::string, std::chrono::steady_clock::time_point> recent_;

    // Prune entries older than the window.
    void prune();
};
