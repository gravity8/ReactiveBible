#pragma once

#include "intent_resolver.h"
#include "book_normalizer.h"
#include <string>
#include <vector>
#include <regex>

// Offline regex-based intent resolver. No network calls.
// Detects verse patterns like "John 3:16", "Genesis chapter 1 verse 2",
// "go to Romans 15:4", and translation switches.
class LocalIntentResolver {
public:
    LocalIntentResolver() = default;

    // Same interface as IntentResolver::resolve().
    IntentResult resolve(const std::string& windowText,
                         const std::string& contextJson = "{}");

private:
    // Try to extract a verse reference from the text.
    IntentResult tryVersePatterns(const std::string& text);

    // Try to detect a translation switch.
    IntentResult tryTranslationSwitch(const std::string& text);

    // Try navigation commands (next verse, verse N, etc.)
    IntentResult tryNavigation(const std::string& text, const std::string& contextJson);

    // Helper: find a Bible book name in the text. Returns the canonical name and
    // the position after the book name in the text.
    struct BookMatch {
        std::string canonical;
        size_t endPos = 0;
        bool found = false;
    };
    static BookMatch findBook(const std::string& text);

    // Helper: lowercase.
    static std::string toLower(const std::string& s);
};
