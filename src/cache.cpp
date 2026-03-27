#include "cache.h"
#include <fstream>
#include <filesystem>
#include <iostream>

namespace fs = std::filesystem;

std::string Cache::makeKey(const std::string& translation,
                            const std::string& book,
                            int chapter, int verse) {
    return translation + ":" + book + ":" + std::to_string(chapter) + ":" + std::to_string(verse);
}

bool Cache::loadTranslation(const std::string& translation, const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        std::cerr << "[cache] Failed to open: " << filepath << "\n";
        return false;
    }

    nlohmann::json j;
    try {
        file >> j;
    } catch (const nlohmann::json::exception& e) {
        std::cerr << "[cache] JSON parse error in " << filepath << ": " << e.what() << "\n";
        return false;
    }

    int count = 0;

    // Support two formats:
    // Format 1 (flat): { "Genesis 1:1": "In the beginning...", ... }
    // Format 2 (nested): { "Genesis": { "1": { "1": "In the beginning...", ... } } }
    if (j.is_object()) {
        auto it = j.begin();
        if (it != j.end() && it.value().is_object()) {
            // Nested format: { "Book": { "Chapter": { "Verse": "text" } } }
            for (auto& [book, chapters] : j.items()) {
                if (!chapters.is_object()) continue;
                for (auto& [ch, verses] : chapters.items()) {
                    if (!verses.is_object()) continue;
                    int chNum = std::stoi(ch);
                    for (auto& [v, text] : verses.items()) {
                        int vNum = std::stoi(v);
                        std::string key = makeKey(translation, book, chNum, vNum);
                        l1_map_[key] = text.get<std::string>();
                        count++;
                    }
                }
            }
        } else if (it != j.end() && it.value().is_string()) {
            // Flat format: { "Book Chapter:Verse": "text" }
            for (auto& [ref, text] : j.items()) {
                // Parse "Book Chapter:Verse" → book, chapter, verse
                auto lastSpace = ref.rfind(' ');
                if (lastSpace == std::string::npos) continue;

                std::string book = ref.substr(0, lastSpace);
                std::string chv = ref.substr(lastSpace + 1);

                auto colon = chv.find(':');
                if (colon == std::string::npos) continue;

                int ch = std::stoi(chv.substr(0, colon));
                int v = std::stoi(chv.substr(colon + 1));

                std::string key = makeKey(translation, book, ch, v);
                l1_map_[key] = text.get<std::string>();
                count++;
            }
        }
    }

    std::cerr << "[cache] Loaded " << count << " verses for " << translation
              << " from " << filepath << "\n";
    return count > 0;
}

bool Cache::loadFromDiskCache(const std::string& translation, const std::string& cacheDir) {
    std::string path = cacheDir + "/" + translation + ".json";
    if (!fs::exists(path)) {
        return false;
    }
    return loadTranslation(translation, path);
}

bool Cache::saveToDiskCache(const std::string& translation, const std::string& cacheDir) {
    fs::create_directories(cacheDir);

    // Extract all L1 entries for this translation into nested JSON.
    nlohmann::json j;
    std::string prefix = translation + ":";

    // Check L1 map.
    for (const auto& [key, text] : l1_map_) {
        if (key.substr(0, prefix.size()) != prefix) continue;

        // Parse key: "TRANS:Book:Chapter:Verse"
        std::string rest = key.substr(prefix.size());
        auto c1 = rest.find(':');
        auto c2 = rest.find(':', c1 + 1);
        if (c1 == std::string::npos || c2 == std::string::npos) continue;

        std::string book = rest.substr(0, c1);
        std::string ch = rest.substr(c1 + 1, c2 - c1 - 1);
        std::string v = rest.substr(c2 + 1);

        j[book][ch][v] = text;
    }

    // Also check runtime map.
    {
        std::lock_guard<std::mutex> lock(runtime_mutex_);
        for (const auto& [key, text] : runtime_map_) {
            if (key.substr(0, prefix.size()) != prefix) continue;

            std::string rest = key.substr(prefix.size());
            auto c1 = rest.find(':');
            auto c2 = rest.find(':', c1 + 1);
            if (c1 == std::string::npos || c2 == std::string::npos) continue;

            std::string book = rest.substr(0, c1);
            std::string ch = rest.substr(c1 + 1, c2 - c1 - 1);
            std::string v = rest.substr(c2 + 1);

            j[book][ch][v] = text;
        }
    }

    std::string path = cacheDir + "/" + translation + ".json";
    std::ofstream file(path);
    if (!file.is_open()) {
        std::cerr << "[cache] Failed to write disk cache: " << path << "\n";
        return false;
    }
    file << j.dump(2);
    return true;
}

std::optional<Verse> Cache::lookup(const std::string& translation,
                                    const std::string& book,
                                    int chapter, int verse) const {
    std::string key = makeKey(translation, book, chapter, verse);

    // Step A: check L1 map.
    auto it = l1_map_.find(key);
    if (it != l1_map_.end()) {
        return Verse{it->second, book, chapter, verse, translation};
    }

    // Step B: check runtime map.
    {
        std::lock_guard<std::mutex> lock(runtime_mutex_);
        auto rit = runtime_map_.find(key);
        if (rit != runtime_map_.end()) {
            return Verse{rit->second, book, chapter, verse, translation};
        }
    }

    // Step C: miss.
    return std::nullopt;
}

void Cache::storeChapter(const std::string& translation,
                          const std::string& book,
                          int chapter,
                          const std::vector<Verse>& verses) {
    std::lock_guard<std::mutex> lock(runtime_mutex_);
    for (const auto& v : verses) {
        std::string key = makeKey(translation, book, chapter, v.verse);
        runtime_map_[key] = v.text;
    }
}

void Cache::storeVerse(const Verse& v) {
    std::lock_guard<std::mutex> lock(runtime_mutex_);
    std::string key = makeKey(v.translation, v.book, v.chapter, v.verse);
    runtime_map_[key] = v.text;
}

bool Cache::hasTranslation(const std::string& translation) const {
    std::string prefix = translation + ":";
    for (const auto& [key, _] : l1_map_) {
        if (key.substr(0, prefix.size()) == prefix) return true;
    }
    return false;
}
