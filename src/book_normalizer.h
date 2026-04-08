#pragma once

#include <string>
#include <vector>
#include <optional>
#include <unordered_map>

// Corrects garbled book names from Whisper STT to canonical Bible book names.
// Uses edit distance + phonetic (Soundex) matching.
class BookNormalizer {
public:
    // Returns the canonical book name if a match is found within threshold.
    // Returns nullopt if no reasonable match.
    static std::optional<std::string> normalize(const std::string& input);

    // Get the list of all canonical book names.
    static const std::vector<std::string>& canonicalBooks();

    // Add runtime aliases (e.g. from a pastor profile's pronunciation map).
    static void addAliases(const std::unordered_map<std::string, std::string>& extra);

private:
    // Levenshtein edit distance (case-insensitive).
    static int editDistance(const std::string& a, const std::string& b);

    // Soundex code for phonetic comparison.
    static std::string soundex(const std::string& input);

    // Lowercase a string.
    static std::string toLower(const std::string& s);
};
