#include "dedup.h"

DedupGate::DedupGate(int windowSeconds)
    : window_seconds_(windowSeconds) {}

bool DedupGate::isDuplicate(const std::string& reference, const std::string& translation) {
    std::lock_guard<std::mutex> lock(mutex_);

    prune();

    std::string key = reference + "|" + translation;
    auto now = std::chrono::steady_clock::now();

    auto it = recent_.find(key);
    if (it != recent_.end()) {
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - it->second).count();
        if (elapsed < window_seconds_) {
            return true; // Duplicate — suppress.
        }
    }

    // Not a duplicate — record and allow.
    recent_[key] = now;
    return false;
}

void DedupGate::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    recent_.clear();
}

void DedupGate::prune() {
    auto now = std::chrono::steady_clock::now();
    for (auto it = recent_.begin(); it != recent_.end();) {
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - it->second).count();
        if (elapsed >= window_seconds_ * 2) {
            it = recent_.erase(it);
        } else {
            ++it;
        }
    }
}
