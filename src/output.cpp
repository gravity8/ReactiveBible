#include "output.h"
#include <iostream>

void Output::onVerse(OutputCallback callback) {
    callbacks_.push_back(std::move(callback));
}

void Output::emit(const VerseOutput& output) {
    // Write to stdout.
    std::cout << toJson(output) << std::endl;

    // Notify all registered callbacks.
    for (const auto& cb : callbacks_) {
        cb(output);
    }
}

std::string Output::toJson(const VerseOutput& output) {
    nlohmann::json j;
    j["text"] = output.text;
    j["reference"] = output.reference;
    j["active"] = output.active;
    j["default"] = output.defaultTrans;
    j["copyright"] = output.copyright;
    return j.dump();
}
