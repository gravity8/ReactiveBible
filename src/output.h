#pragma once

#include "cache.h"
#include <string>
#include <functional>
#include <nlohmann/json.hpp>

struct VerseOutput {
    std::string text;
    std::string reference;   // e.g. "John 3:16"
    std::string active;      // active translation code
    std::string defaultTrans; // default translation code
    std::string copyright;   // copyright attribution
};

// Callback type for consumers.
using OutputCallback = std::function<void(const VerseOutput&)>;

class Output {
public:
    // Register a callback for verse output events.
    void onVerse(OutputCallback callback);

    // Emit a verse to stdout and all registered callbacks.
    void emit(const VerseOutput& output);

    // Convert VerseOutput to JSON string.
    static std::string toJson(const VerseOutput& output);

private:
    std::vector<OutputCallback> callbacks_;
};
