#pragma once

#include "cache.h"
#include <string>
#include <vector>

struct FetchResult {
    bool success = false;
    std::vector<Verse> verses;
    std::string error;
};

class ApiFetch {
public:
    ApiFetch() = default;

    // Fetch an entire chapter from BibleGateway.
    FetchResult fetchChapter(const std::string& translation,
                             const std::string& book,
                             int chapter);

private:
    // Build BibleGateway URL for a chapter.
    static std::string buildUrl(const std::string& book, int chapter,
                                const std::string& translation);

    // Parse BibleGateway HTML response into verses.
    static std::vector<Verse> parseHtml(const std::string& html,
                                         const std::string& translation,
                                         const std::string& book,
                                         int chapter);

    // Map our translation codes to BibleGateway version codes.
    static std::string toBibleGatewayCode(const std::string& translation);
};
