#pragma once

#include <string>
#include <unordered_map>

struct PastorProfile {
    std::string id;
    std::string name;
    std::string preferredTranslation;
    std::string whisperPromptExtension;
    std::string llmPromptExtension;
    std::unordered_map<std::string, std::string> pronunciationMap;
    bool loaded = false;
};

// Load a pastor profile from a JSON file.
// Returns a profile with loaded=false if the file is missing or invalid.
PastorProfile loadPastorProfile(const std::string& path);
