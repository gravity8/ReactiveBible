#include "api_fetch.h"
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <regex>
#include <unordered_map>
#include <memory>

static size_t writeCallback(char* ptr, size_t size, size_t nmemb, std::string* data) {
    data->append(ptr, size * nmemb);
    return size * nmemb;
}

// YouVersion Bible version IDs.
static int getVersionId(const std::string& translation) {
    static const std::unordered_map<std::string, int> ids = {
        {"KJV",  1},     {"NKJV", 114},   {"NIV",  111},
        {"NLT",  116},   {"ESV",  59},     {"AMP",  1588},
        {"AMPC", 8},     {"MSG",  97},     {"TPT",  1849},
        {"NASB", 2692},  {"CSB",  1713},   {"CEV",  392},
        {"GNT",  68},    {"ICB",  1359},   {"ASV",  12},
        {"WEB",  206},   {"YLT",  821},    {"HCSB", 72},
    };
    auto it = ids.find(translation);
    return it != ids.end() ? it->second : -1;
}

// Map book names to USFM abbreviations used by YouVersion.
static std::string bookToUsfm(const std::string& book) {
    static const std::unordered_map<std::string, std::string> usfm = {
        {"Genesis", "GEN"}, {"Exodus", "EXO"}, {"Leviticus", "LEV"},
        {"Numbers", "NUM"}, {"Deuteronomy", "DEU"}, {"Joshua", "JOS"},
        {"Judges", "JDG"}, {"Ruth", "RUT"}, {"1 Samuel", "1SA"},
        {"2 Samuel", "2SA"}, {"1 Kings", "1KI"}, {"2 Kings", "2KI"},
        {"1 Chronicles", "1CH"}, {"2 Chronicles", "2CH"}, {"Ezra", "EZR"},
        {"Nehemiah", "NEH"}, {"Esther", "EST"}, {"Job", "JOB"},
        {"Psalms", "PSA"}, {"Proverbs", "PRO"}, {"Ecclesiastes", "ECC"},
        {"Song of Solomon", "SNG"}, {"Isaiah", "ISA"}, {"Jeremiah", "JER"},
        {"Lamentations", "LAM"}, {"Ezekiel", "EZK"}, {"Daniel", "DAN"},
        {"Hosea", "HOS"}, {"Joel", "JOL"}, {"Amos", "AMO"},
        {"Obadiah", "OBA"}, {"Jonah", "JON"}, {"Micah", "MIC"},
        {"Nahum", "NAM"}, {"Habakkuk", "HAB"}, {"Zephaniah", "ZEP"},
        {"Haggai", "HAG"}, {"Zechariah", "ZEC"}, {"Malachi", "MAL"},
        {"Matthew", "MAT"}, {"Mark", "MRK"}, {"Luke", "LUK"},
        {"John", "JHN"}, {"Acts", "ACT"}, {"Romans", "ROM"},
        {"1 Corinthians", "1CO"}, {"2 Corinthians", "2CO"},
        {"Galatians", "GAL"}, {"Ephesians", "EPH"}, {"Philippians", "PHP"},
        {"Colossians", "COL"}, {"1 Thessalonians", "1TH"},
        {"2 Thessalonians", "2TH"}, {"1 Timothy", "1TI"},
        {"2 Timothy", "2TI"}, {"Titus", "TIT"}, {"Philemon", "PHM"},
        {"Hebrews", "HEB"}, {"James", "JAS"}, {"1 Peter", "1PE"},
        {"2 Peter", "2PE"}, {"1 John", "1JN"}, {"2 John", "2JN"},
        {"3 John", "3JN"}, {"Jude", "JUD"}, {"Revelation", "REV"},
    };
    auto it = usfm.find(book);
    return it != usfm.end() ? it->second : book;
}

// Decode HTML entities (&amp; &#8220; etc.)
static std::string decodeHtmlEntities(const std::string& input) {
    std::string result = input;

    // Named entities.
    static const std::unordered_map<std::string, std::string> entities = {
        {"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"},
        {"&quot;", "\""}, {"&apos;", "'"},
    };
    for (const auto& [ent, rep] : entities) {
        size_t pos = 0;
        while ((pos = result.find(ent, pos)) != std::string::npos) {
            result.replace(pos, ent.size(), rep);
            pos += rep.size();
        }
    }

    // Numeric entities: &#8220; &#8217; etc.
    std::regex numEnt(R"(&#(\d+);)");
    std::string decoded;
    std::sregex_iterator it(result.begin(), result.end(), numEnt);
    std::sregex_iterator end;
    size_t lastPos = 0;

    for (; it != end; ++it) {
        decoded += result.substr(lastPos, it->position() - lastPos);
        int code = std::stoi((*it)[1].str());
        // Common Unicode punctuation → ASCII equivalents.
        if (code == 8220 || code == 8221) decoded += "\"";
        else if (code == 8216 || code == 8217) decoded += "'";
        else if (code == 8212) decoded += " — ";
        else if (code == 8211) decoded += " - ";
        else if (code < 128) decoded += static_cast<char>(code);
        else decoded += " ";
        lastPos = it->position() + it->length();
    }
    decoded += result.substr(lastPos);
    return decoded;
}

std::string ApiFetch::buildUrl(const std::string& book, int chapter,
                                const std::string& translation) {
    int versionId = getVersionId(translation);
    if (versionId < 0) versionId = 1; // fallback to KJV

    std::string usfm = bookToUsfm(book);
    return "https://www.bible.com/bible/" + std::to_string(versionId) +
           "/" + usfm + "." + std::to_string(chapter) + "." + translation;
}

std::vector<Verse> ApiFetch::parseHtml(const std::string& html,
                                        const std::string& translation,
                                        const std::string& book,
                                        int chapter) {
    std::vector<Verse> verses;

    // Extract __NEXT_DATA__ JSON from the page.
    std::regex nextDataRe(R"(<script id="__NEXT_DATA__"[^>]*>(.*?)</script>)");
    std::smatch m;
    if (!std::regex_search(html, m, nextDataRe)) {
        std::cerr << "[fetch] No __NEXT_DATA__ found in response\n";
        return verses;
    }

    try {
        auto data = nlohmann::json::parse(m[1].str());
        std::string content = data["props"]["pageProps"]["chapterInfo"]["content"].get<std::string>();

        std::string usfm = bookToUsfm(book);

        // Extract verses using data-usfm attribute.
        // Pattern: data-usfm="BOOK.CHAPTER.VERSE"
        std::string pattern = "data-usfm=\"" + usfm + "\\." + std::to_string(chapter) + "\\.(\\d+)\"[^>]*>(.*?)(?=data-usfm=\"|$)";
        std::regex verseRe(pattern, std::regex::ECMAScript);

        std::unordered_map<int, std::string> verseMap;
        auto it = std::sregex_iterator(content.begin(), content.end(), verseRe);
        auto end = std::sregex_iterator();

        for (; it != end; ++it) {
            int vNum = std::stoi((*it)[1].str());
            if (verseMap.count(vNum)) continue; // keep first occurrence

            std::string raw = (*it)[2].str();

            // Strip HTML tags.
            std::string text;
            bool inTag = false;
            for (char c : raw) {
                if (c == '<') { inTag = true; continue; }
                if (c == '>') { inTag = false; continue; }
                if (!inTag) text += c;
            }

            // Decode HTML entities.
            text = decodeHtmlEntities(text);

            // Normalize whitespace.
            std::string clean;
            bool lastSpace = false;
            for (char c : text) {
                if (c == '\n' || c == '\r' || c == '\t') c = ' ';
                if (c == ' ' && lastSpace) continue;
                clean += c;
                lastSpace = (c == ' ');
            }

            // Trim.
            auto start = clean.find_first_not_of(' ');
            auto back = clean.find_last_not_of(' ');
            if (start == std::string::npos) continue;
            clean = clean.substr(start, back - start + 1);

            // Remove leading verse number.
            std::regex leadingNum(R"(^\d+\s*)");
            clean = std::regex_replace(clean, leadingNum, "");

            // Remove footnote markers like # 3:1 ... at end, or [a], [b].
            std::regex footnoteHash(R"(\s*#\s*\d+:\d+\s*.*)");
            clean = std::regex_replace(clean, footnoteHash, "");

            if (!clean.empty()) {
                verseMap[vNum] = clean;
            }
        }

        for (auto& [vNum, text] : verseMap) {
            verses.push_back(Verse{text, book, chapter, vNum, translation});
        }

    } catch (const std::exception& e) {
        std::cerr << "[fetch] Parse error: " << e.what() << "\n";
    }

    return verses;
}

std::string ApiFetch::toBibleGatewayCode(const std::string& translation) {
    return translation; // Not used anymore but kept for interface compat.
}

FetchResult ApiFetch::fetchChapter(const std::string& translation,
                                    const std::string& book,
                                    int chapter) {
    std::string url = buildUrl(book, chapter, translation);
    std::cerr << "[fetch] YouVersion: " << translation << " " << book
              << " " << chapter << "\n";

    std::unique_ptr<CURL, decltype(&curl_easy_cleanup)> curl(
        curl_easy_init(), &curl_easy_cleanup);
    if (!curl) {
        return FetchResult{false, {}, "Failed to init curl"};
    }

    std::string response;
    std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> headers(
        curl_slist_append(nullptr,
            "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
        &curl_slist_free_all);

    curl_easy_setopt(curl.get(), CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl.get(), CURLOPT_HTTPHEADER, headers.get());
    curl_easy_setopt(curl.get(), CURLOPT_TIMEOUT, 10L);
    curl_easy_setopt(curl.get(), CURLOPT_FOLLOWLOCATION, 1L);

    CURLcode res = curl_easy_perform(curl.get());
    long httpCode = 0;
    curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &httpCode);

    if (res != CURLE_OK) {
        return FetchResult{false, {}, "curl error: " + std::string(curl_easy_strerror(res))};
    }

    if (httpCode != 200) {
        return FetchResult{false, {}, "HTTP " + std::to_string(httpCode)};
    }

    auto verses = parseHtml(response, translation, book, chapter);
    if (verses.empty()) {
        return FetchResult{false, {}, "No verses parsed from YouVersion"};
    }

    std::cerr << "[fetch] Got " << verses.size() << " verses\n";
    return FetchResult{true, std::move(verses), ""};
}
