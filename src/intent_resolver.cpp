#include "intent_resolver.h"
#include <nlohmann/json.hpp>
#include <curl/curl.h>
#include <iostream>
#include <memory>

static std::string buildSystemPrompt_() {
    return R"(You are a Bible verse detector for a live sermon. You receive:
1. Raw speech-to-text (noisy, garbled — from Whisper STT)
2. Previous conversation context (the last verse that was displayed)

Your job: determine the intent and resolve the COMPLETE verse reference using context.

Return ONLY valid JSON:
{
  "intent": "SHOW_VERSE" | "CHANGE_TRANSLATION" | "IGNORE",
  "book": string or null,
  "chapter": number or null,
  "verse": number or null,
  "translation": string or null,
  "confidence": float 0.0-1.0
}

INTENTS:
- SHOW_VERSE: A verse reference or navigation command is detected. Return the FULL resolved reference.
- CHANGE_TRANSLATION: A Bible translation/version change is requested.
- IGNORE: Sermon narration, prayer, filler, or no verse reference.

═══ CONTEXT RESOLUTION (CRITICAL) ═══

You will receive "previous_context" with the last displayed verse. USE IT to resolve partial references:

  "verse 21" + context {James 1:17} → James 1:21
  "chapter 3" + context {James 1:17} → James 3:1
  "same verse in NLT" + context {James 1:17, KJV} → James 1:17 (translation: NLT)
  "Exodus" (book only) + context {James 1:17} → IGNORE (incomplete, wait for more)
  "Exodus 3" (no verse) + context → Exodus 3:1 (default to verse 1)
  "verse 5" (no book/chapter) + context {Exodus 3:1} → Exodus 3:5

If the speaker gives a FULL reference (book + chapter + verse), use it as-is — don't carry over context.
If only partial info is given, fill in the gaps from context.
If context is empty or expired ({}) and the reference is partial, return what you have (may be incomplete).

IMPORTANT: Do NOT treat navigation phrases like "next verse", "previous verse", "go back",
"read that again", "continue", "keep going" as verse references. Return IGNORE for these.

═══ STT ERROR CORRECTION ═══

The speech-to-text WILL garble Bible book names (especially Nigerian accent). Correct them:
- "Ruman" / "Ruman Zontu" → "Romans"
- "Ex-Sudos" / "X2DOS" → "Exodus"
- "Abakuk" / "Abba Kook" → "Habakkuk"
- "Aizia" / "Izaiah" → "Isaiah"
- "Revolution" / "Revelations" → "Revelation"
- "Colossian" → "Colossians"
- "Filipino" → "Philippians"
- "Duderonomy" → "Deuteronomy"
Use your world knowledge to correct ANY garbled book name.

═══ REAL SERMON VERSE PATTERNS ═══

These are REAL patterns from live sermons. Recognize ALL of them:

EXPLICIT REFERENCES:
- "Luke chapter 1 and verse 53" → Luke 1:53
- "go to Romans 15:4" → Romans 15:4
- "open with Genesis 15:1" → Genesis 15:1
- "James 1:4 let patience have..." → James 1:4
- "Romans chapter 10 and verse 12" → Romans 10:12
- "Colossians 3:15. Amplified classic" → Colossians 3:15 (translation: AMPC)

NUMBERS THAT LOOK WRONG (STT merges chapter:verse):
- "Exodus 115" → likely Exodus 1:15 (NOT chapter 115)
- "Romans 12" → could be Romans 1:2 or Romans 12 (default to verse 1)
- "Genesis 43" → likely Genesis 4:3 (split smartly based on book's chapter count)

PARTIAL REFERENCES (use previous_context):
- "verse 8" / "verse four" / "um verse 11" → keep book+chapter from context
- "chapter 3" → keep book from context, verse defaults to 1
- "we're going to read verse two now" → keep book+chapter, verse=2
- "go to verse 5" → keep book+chapter from context, verse=5
- "give me verse 12" → keep book+chapter from context, verse=12

NAVIGATION (use previous_context):
- "next verse" + context {James 1:17} → James 1:18
- "previous verse" + context {James 1:17} → James 1:16
- "the verse before" + context {James 1:17} → James 1:16
- "go back" + context {James 1:17} → James 1:16
- "next chapter" + context {James 1:17} → James 2:1

RAPID CROSS-REFERENCES (multiple verses in one breath):
- "Acts 7:58...James 1:21...1 Peter 2:1" → show each as detected
- "you see it in Romans 13:12" → Romans 13:12

TRANSLATION SWITCHES:
- "I read in the New Living Translation" → NLT
- "let's read that in the amplified classic version" → AMPC
- "Amplified classic" after a verse → AMPC for that verse

IGNORE (NOT verse references):
- "amen", "hallelujah", "glory to God"
- "say after me", "tell three persons"
- "I was talking to a couple"
- "the word of God says..." (generic, no specific reference)
- "are you seeing that" / "did you see that"

═══ BOOK NAMES (canonical) ═══

Genesis, Exodus, Leviticus, Numbers, Deuteronomy, Joshua, Judges, Ruth, 1 Samuel, 2 Samuel, 1 Kings, 2 Kings, 1 Chronicles, 2 Chronicles, Ezra, Nehemiah, Esther, Job, Psalms, Proverbs, Ecclesiastes, Song of Solomon, Isaiah, Jeremiah, Lamentations, Ezekiel, Daniel, Hosea, Joel, Amos, Obadiah, Jonah, Micah, Nahum, Habakkuk, Zephaniah, Haggai, Zechariah, Malachi, Matthew, Mark, Luke, John, Acts, Romans, 1 Corinthians, 2 Corinthians, Galatians, Ephesians, Philippians, Colossians, 1 Thessalonians, 2 Thessalonians, 1 Timothy, 2 Timothy, Titus, Philemon, Hebrews, James, 1 Peter, 2 Peter, 1 John, 2 John, 3 John, Jude, Revelation

═══ TRANSLATION CODES ═══

KJV, NIV, NLT, AMP, AMPC, NKJV, MSG, TPT, ESV, NASB

═══ RULES ═══

- Always return the COMPLETE resolved reference (book + chapter + verse) when possible.
- If no clear verse reference or navigation command exists, return IGNORE.
- Do NOT hallucinate. If unsure, return IGNORE.
- Return ONLY the JSON object.)";
}

IntentResolver::IntentResolver(const std::string& groqApiKey)
    : api_key_(groqApiKey) {
    system_prompt_ = buildSystemPrompt_();
    curl_ = curl_easy_init();
}

void IntentResolver::setProfileExtension(const std::string& extension) {
    if (!extension.empty()) {
        system_prompt_ += "\n\n" + extension;
    }
}

IntentResolver::~IntentResolver() {
    if (curl_) {
        curl_easy_cleanup(curl_);
        curl_ = nullptr;
    }
}

static size_t writeCallback(char* ptr, size_t size, size_t nmemb, std::string* data) {
    data->append(ptr, size * nmemb);
    return size * nmemb;
}

std::string IntentResolver::callGroqApi(const std::string& userMessage) {
    std::lock_guard<std::mutex> lock(curl_mutex_);

    if (!curl_) {
        std::cerr << "[intent] No curl handle\n";
        return "";
    }

    nlohmann::json requestBody;
    requestBody["model"] = "llama-3.1-8b-instant";
    requestBody["messages"] = nlohmann::json::array({
        {{"role", "system"}, {"content", system_prompt_}},
        {{"role", "user"}, {"content", userMessage}}
    });
    requestBody["temperature"] = 0.1;
    requestBody["max_tokens"] = 200;
    requestBody["response_format"] = {{"type", "json_object"}};

    std::string body = requestBody.dump();
    std::string response;

    std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> headers(
        nullptr, &curl_slist_free_all);
    headers.reset(curl_slist_append(nullptr, "Content-Type: application/json"));
    std::string authHeader = "Authorization: Bearer " + api_key_;
    headers.reset(curl_slist_append(headers.release(), authHeader.c_str()));

    curl_easy_reset(curl_);
    curl_easy_setopt(curl_, CURLOPT_URL, "https://api.groq.com/openai/v1/chat/completions");
    curl_easy_setopt(curl_, CURLOPT_HTTPHEADER, headers.get());
    curl_easy_setopt(curl_, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl_, CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl_, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl_, CURLOPT_TIMEOUT, 5L);

    CURLcode res = curl_easy_perform(curl_);

    if (res != CURLE_OK) {
        std::cerr << "[intent] Groq API error: " << curl_easy_strerror(res) << "\n";
        return "";
    }

    return response;
}

IntentResult IntentResolver::parseResponse(const std::string& jsonResponse) {
    IntentResult result;

    try {
        auto j = nlohmann::json::parse(jsonResponse);

        std::string content;
        if (j.contains("choices") && !j["choices"].empty()) {
            content = j["choices"][0]["message"]["content"].get<std::string>();
        } else {
            // API returned error or unexpected format.
            if (j.contains("error")) {
                std::string errMsg = j["error"].value("message", "unknown");
                std::cerr << "[intent] Groq API returned error: " << errMsg << "\n";
            } else {
                std::cerr << "[intent] Groq response missing 'choices'\n";
            }
            return result;
        }

        auto parsed = nlohmann::json::parse(content);

        std::string intentStr = parsed.value("intent", "IGNORE");
        if (intentStr == "SHOW_VERSE") {
            result.intent = Intent::SHOW_VERSE;
        } else if (intentStr == "CHANGE_TRANSLATION") {
            result.intent = Intent::CHANGE_TRANSLATION;
        } else {
            result.intent = Intent::NONE;
        }

        if (parsed.contains("book") && !parsed["book"].is_null()) {
            result.book = parsed["book"].get<std::string>();
        }
        if (parsed.contains("chapter") && !parsed["chapter"].is_null()) {
            result.chapter = parsed["chapter"].get<int>();
        }
        if (parsed.contains("verse") && !parsed["verse"].is_null()) {
            result.verse = parsed["verse"].get<int>();
        }
        if (parsed.contains("translation") && !parsed["translation"].is_null()) {
            result.translation = parsed["translation"].get<std::string>();
        }
        if (parsed.contains("confidence") && !parsed["confidence"].is_null()) {
            result.confidence = parsed["confidence"].get<float>();
        }

    } catch (const std::exception& e) {
        std::cerr << "[intent] Parse error: " << e.what() << "\n";
    }

    return result;
}

IntentResult IntentResolver::resolve(const std::string& windowText,
                                      const std::string& contextJson) {
    // Skip Groq if we're in rate-limit cooldown.
    auto now = std::chrono::steady_clock::now();
    if (now < rate_limit_until_) {
        return IntentResult{};
    }

    // Build user message with context.
    nlohmann::json userMsg;
    userMsg["speech"] = windowText;
    try {
        userMsg["previous_context"] = nlohmann::json::parse(contextJson);
    } catch (...) {
        userMsg["previous_context"] = nlohmann::json::object();
    }

    std::string response = callGroqApi(userMsg.dump());
    if (response.empty()) {
        return IntentResult{};
    }

    // Check for rate limit error before full parse.
    try {
        auto check = nlohmann::json::parse(response);
        if (check.contains("error")) {
            std::string msg = check["error"].value("message", "");
            if (msg.find("Rate limit") != std::string::npos ||
                msg.find("rate_limit") != std::string::npos) {
                // Back off for 15 seconds.
                rate_limit_until_ = std::chrono::steady_clock::now() + std::chrono::seconds(15);
                std::cerr << "[intent] Rate limited — backing off 15s, using local resolver\n";
                return IntentResult{};
            }
        }
    } catch (...) {}
    return parseResponse(response);
}
