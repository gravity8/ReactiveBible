#pragma once

#include <string>
#include <optional>
#include <mutex>
#include <chrono>

typedef void CURL;

enum class Intent {
    SHOW_VERSE,
    CHANGE_TRANSLATION,
    NONE
};

struct IntentResult {
    Intent intent = Intent::NONE;
    std::string book;
    int chapter = 0;
    int verse = 0;
    std::optional<std::string> translation;
    float confidence = 0.0f;
};

class IntentResolver {
public:
    explicit IntentResolver(const std::string& groqApiKey);
    ~IntentResolver();

    // Resolve intent with conversation context.
    // contextJson: serialized previous reference (from ConversationContext::toJson()).
    IntentResult resolve(const std::string& windowText,
                         const std::string& contextJson = "{}");

private:
    std::string api_key_;
    std::string system_prompt_;

    CURL* curl_ = nullptr;
    std::mutex curl_mutex_;

    // Rate limit backoff: skip Groq calls during cooldown.
    std::chrono::steady_clock::time_point rate_limit_until_{};

    std::string callGroqApi(const std::string& userMessage);
    static IntentResult parseResponse(const std::string& jsonResponse);
};
