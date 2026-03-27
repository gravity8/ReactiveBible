#pragma once

#include "cache.h"
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

enum class ApiSource {
    API_BIBLE,
    GET_BIBLE,
    BIBLE_API_COM
};

// Normalize API-specific JSON responses into a uniform vector of Verse structs.
class Normalizer {
public:
    // Normalize a response from any supported API source.
    static std::vector<Verse> normalize(ApiSource source,
                                        const nlohmann::json& response,
                                        const std::string& translation,
                                        const std::string& book,
                                        int chapter);

private:
    static std::vector<Verse> normalizeApiBible(const nlohmann::json& j,
                                                 const std::string& translation,
                                                 const std::string& book,
                                                 int chapter);

    static std::vector<Verse> normalizeGetBible(const nlohmann::json& j,
                                                 const std::string& translation,
                                                 const std::string& book,
                                                 int chapter);

    static std::vector<Verse> normalizeBibleApiCom(const nlohmann::json& j,
                                                    const std::string& translation,
                                                    const std::string& book,
                                                    int chapter);

    // Strip HTML tags from verse text (some APIs return HTML).
    static std::string stripHtml(const std::string& input);
};
