#include "pastor_profile.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>

PastorProfile loadPastorProfile(const std::string& path) {
    PastorProfile profile;

    if (path.empty()) return profile;

    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "[profile] Could not open profile: " << path << "\n";
        return profile;
    }

    try {
        nlohmann::json j;
        file >> j;

        profile.id = j.value("id", "");
        profile.name = j.value("name", "unknown");

        if (j.contains("preferredTranslation")) {
            auto& pt = j["preferredTranslation"];
            if (pt.is_string()) {
                profile.preferredTranslation = pt.get<std::string>();
            } else if (pt.is_object() && pt.contains("code")) {
                profile.preferredTranslation = pt["code"].get<std::string>();
            }
        }

        profile.whisperPromptExtension = j.value("whisperPromptExtension", "");
        profile.llmPromptExtension = j.value("llmPromptExtension", "");

        if (j.contains("pronunciationMap") && j["pronunciationMap"].is_object()) {
            for (auto& [key, val] : j["pronunciationMap"].items()) {
                if (val.is_string()) {
                    profile.pronunciationMap[key] = val.get<std::string>();
                }
            }
        }

        profile.loaded = true;
        std::cerr << "[profile] Loaded: " << profile.name
                  << " (translation: " << profile.preferredTranslation
                  << ", aliases: " << profile.pronunciationMap.size()
                  << ", whisper ext: " << profile.whisperPromptExtension.size() << " chars"
                  << ", llm ext: " << profile.llmPromptExtension.size() << " chars)\n";

    } catch (const std::exception& e) {
        std::cerr << "[profile] Parse error: " << e.what() << "\n";
    }

    return profile;
}
