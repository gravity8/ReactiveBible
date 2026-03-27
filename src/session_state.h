#pragma once

#include <string>
#include <mutex>

// Priority: operator manual > operator reset > pastor voice
enum class TranslationSource {
    CONFIG,         // initial value from config.json
    PASTOR_VOICE,   // detected via Groq intent
    OPERATOR_MANUAL // operator explicitly selected
};

class SessionState {
public:
    explicit SessionState(const std::string& defaultTranslation);

    // Get the currently active translation.
    std::string getActiveTranslation() const;

    // Get the default translation (immutable, from config).
    std::string getDefaultTranslation() const;

    // Pastor voice requests a translation change.
    // Ignored if operator has manually locked.
    // Returns true if the change was applied.
    bool setPastorTranslation(const std::string& translation);

    // Operator manually selects a translation (highest priority).
    void setOperatorTranslation(const std::string& translation);

    // Operator resets to default translation.
    void resetToDefault();

    // Check if operator has manually locked a translation.
    bool isOperatorLocked() const;

private:
    const std::string default_translation_;

    mutable std::mutex mutex_;
    std::string active_translation_;
    TranslationSource source_;
};
