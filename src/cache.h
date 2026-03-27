#pragma once

#include <string>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <nlohmann/json.hpp>

struct Verse {
    std::string text;
    std::string book;
    int chapter = 0;
    int verse = 0;
    std::string translation;
};

class Cache {
public:
    // Load a translation from a JSON file into the L1 map.
    // JSON format: { "Book Chapter:Verse": "text", ... } or nested.
    bool loadTranslation(const std::string& translation, const std::string& filepath);

    // Load a translation from disk cache (bible_cache/).
    bool loadFromDiskCache(const std::string& translation, const std::string& cacheDir);

    // Save a translation's data to disk cache for future boots.
    bool saveToDiskCache(const std::string& translation, const std::string& cacheDir);

    // Primary lookup: L1 → Runtime → miss (returns nullopt).
    std::optional<Verse> lookup(const std::string& translation,
                                const std::string& book,
                                int chapter, int verse) const;

    // Store an entire chapter into the runtime map.
    void storeChapter(const std::string& translation,
                      const std::string& book,
                      int chapter,
                      const std::vector<Verse>& verses);

    // Store a single verse into the runtime map.
    void storeVerse(const Verse& v);

    // Check if a translation is loaded in L1.
    bool hasTranslation(const std::string& translation) const;

private:
    static std::string makeKey(const std::string& translation,
                               const std::string& book,
                               int chapter, int verse);

    // L1 Map — loaded at startup, read-only during service.
    std::unordered_map<std::string, std::string> l1_map_;

    // Runtime Map — built during session from API fetches.
    mutable std::mutex runtime_mutex_;
    std::unordered_map<std::string, std::string> runtime_map_;
};
