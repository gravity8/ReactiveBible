#include "normalizer.h"
#include <regex>
#include <iostream>

std::vector<Verse> Normalizer::normalize(ApiSource source,
                                          const nlohmann::json& response,
                                          const std::string& translation,
                                          const std::string& book,
                                          int chapter) {
    switch (source) {
        case ApiSource::API_BIBLE:
            return normalizeApiBible(response, translation, book, chapter);
        case ApiSource::GET_BIBLE:
            return normalizeGetBible(response, translation, book, chapter);
        case ApiSource::BIBLE_API_COM:
            return normalizeBibleApiCom(response, translation, book, chapter);
    }
    return {};
}

std::vector<Verse> Normalizer::normalizeApiBible(const nlohmann::json& j,
                                                   const std::string& translation,
                                                   const std::string& book,
                                                   int chapter) {
    // API.Bible response shape:
    // { "data": { "content": [ { "items": [ { "attrs": { "number": "1" }, "text": "..." } ] } ] } }
    // Or sometimes: { "data": { "verses": [ { "orgId": "GEN.1.1", "text": "..." } ] } }
    std::vector<Verse> verses;

    try {
        if (j.contains("data") && j["data"].contains("verses")) {
            for (const auto& v : j["data"]["verses"]) {
                Verse verse;
                verse.book = book;
                verse.chapter = chapter;
                verse.translation = translation;

                // Parse verse number from orgId (e.g. "GEN.1.1")
                if (v.contains("orgId")) {
                    std::string orgId = v["orgId"].get<std::string>();
                    auto lastDot = orgId.rfind('.');
                    if (lastDot != std::string::npos) {
                        verse.verse = std::stoi(orgId.substr(lastDot + 1));
                    }
                } else if (v.contains("number")) {
                    verse.verse = std::stoi(v["number"].get<std::string>());
                }

                if (v.contains("text")) {
                    verse.text = stripHtml(v["text"].get<std::string>());
                }

                if (!verse.text.empty() && verse.verse > 0) {
                    verses.push_back(std::move(verse));
                }
            }
        } else if (j.contains("data") && j["data"].contains("content")) {
            // Content-based format — parse HTML content.
            std::string content = j["data"]["content"].get<std::string>();
            // This format requires HTML parsing; simplified extraction.
            std::string cleaned = stripHtml(content);
            if (!cleaned.empty()) {
                Verse verse;
                verse.book = book;
                verse.chapter = chapter;
                verse.verse = 1;
                verse.translation = translation;
                verse.text = cleaned;
                verses.push_back(std::move(verse));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[normalizer] API.Bible parse error: " << e.what() << "\n";
    }

    return verses;
}

std::vector<Verse> Normalizer::normalizeGetBible(const nlohmann::json& j,
                                                   const std::string& translation,
                                                   const std::string& book,
                                                   int chapter) {
    // GetBible v2 response shape:
    // [ { "chapter": 1, "verse": 1, "name": "Genesis 1:1", "text": "In the beginning..." }, ... ]
    // Or sometimes nested under a translation key.
    std::vector<Verse> verses;

    try {
        // Try direct array format.
        nlohmann::json arr;
        if (j.is_array()) {
            arr = j;
        } else if (j.is_object()) {
            // Might be { "translationCode": [ ... ] } or { "verses": [ ... ] }
            for (auto& [key, val] : j.items()) {
                if (val.is_array()) {
                    arr = val;
                    break;
                }
                if (val.is_object() && val.contains("verses") && val["verses"].is_array()) {
                    arr = val["verses"];
                    break;
                }
            }
        }

        for (const auto& item : arr) {
            Verse verse;
            verse.book = book;
            verse.chapter = chapter;
            verse.translation = translation;

            if (item.contains("verse")) {
                verse.verse = item["verse"].get<int>();
            }
            if (item.contains("text")) {
                verse.text = stripHtml(item["text"].get<std::string>());
            }

            if (!verse.text.empty() && verse.verse > 0) {
                verses.push_back(std::move(verse));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[normalizer] GetBible parse error: " << e.what() << "\n";
    }

    return verses;
}

std::vector<Verse> Normalizer::normalizeBibleApiCom(const nlohmann::json& j,
                                                      const std::string& translation,
                                                      const std::string& book,
                                                      int chapter) {
    // bible-api.com response shape:
    // { "verses": [ { "verse": 1, "text": "In the beginning..." }, ... ] }
    std::vector<Verse> verses;

    try {
        nlohmann::json arr;
        if (j.contains("verses") && j["verses"].is_array()) {
            arr = j["verses"];
        } else if (j.is_array()) {
            arr = j;
        }

        for (const auto& item : arr) {
            Verse verse;
            verse.book = book;
            verse.chapter = chapter;
            verse.translation = translation;

            if (item.contains("verse")) {
                verse.verse = item["verse"].get<int>();
            }
            if (item.contains("text")) {
                verse.text = stripHtml(item["text"].get<std::string>());
            }

            if (!verse.text.empty() && verse.verse > 0) {
                verses.push_back(std::move(verse));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[normalizer] Bible-API.com parse error: " << e.what() << "\n";
    }

    return verses;
}

std::string Normalizer::stripHtml(const std::string& input) {
    // Remove HTML tags.
    std::string result;
    bool inTag = false;
    for (char c : input) {
        if (c == '<') { inTag = true; continue; }
        if (c == '>') { inTag = false; continue; }
        if (!inTag) result += c;
    }

    // Trim whitespace.
    auto start = result.find_first_not_of(" \t\n\r");
    auto end = result.find_last_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    return result.substr(start, end - start + 1);
}
