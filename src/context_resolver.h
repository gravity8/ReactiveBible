#pragma once

#include "intent_resolver.h"
#include <string>
#include <vector>
#include <chrono>
#include <mutex>
#include <optional>

struct ConversationContext {
    std::string book;
    int chapter = 0;
    int verse = 0;
    std::string translation;
    std::chrono::steady_clock::time_point lastUpdated;

    // Recent verse history for "go back" / "that verse again" patterns.
    struct HistoryEntry {
        std::string book;
        int chapter;
        int verse;
    };
    std::vector<HistoryEntry> history; // last N emitted verses

    bool hasReference() const {
        return !book.empty() && chapter > 0;
    }

    bool isExpired(int timeoutSeconds = 180) const {
        if (book.empty()) return true;
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now() - lastUpdated).count();
        return elapsed > timeoutSeconds;
    }

    // Serialize for passing to LLM.
    std::string toJson() const;
};

struct ResolvedReference {
    std::string book;
    int chapter = 0;
    int verse = 0;
    std::string translation;
    bool valid = false;
    bool fromShortcut = false;
};

class ContextResolver {
public:
    // Merge an intent result with conversation context.
    // Fills in missing fields from previous context.
    ResolvedReference resolve(const IntentResult& intent,
                              const std::string& activeTranslation);

    // Update context after a successful verse emission.
    void update(const ResolvedReference& ref);

    // Get current context (thread-safe copy).
    ConversationContext getContext() const;

    // Clear context (e.g., explicit reset).
    void clear();

    // Try to handle shortcut commands without LLM.
    // Only handles unambiguous patterns. Returns nullopt if LLM needed.
    std::optional<ResolvedReference> tryShortcut(const std::string& windowText,
                                                  const std::string& activeTranslation);

private:
    mutable std::mutex mutex_;
    ConversationContext ctx_;
    static const int MAX_HISTORY = 10;
};
