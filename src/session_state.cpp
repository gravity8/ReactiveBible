#include "session_state.h"

SessionState::SessionState(const std::string& defaultTranslation)
    : default_translation_(defaultTranslation)
    , active_translation_(defaultTranslation)
    , source_(TranslationSource::CONFIG) {}

std::string SessionState::getActiveTranslation() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return active_translation_;
}

std::string SessionState::getDefaultTranslation() const {
    return default_translation_;
}

bool SessionState::setPastorTranslation(const std::string& translation) {
    std::lock_guard<std::mutex> lock(mutex_);

    // If operator has manually locked, ignore pastor voice.
    if (source_ == TranslationSource::OPERATOR_MANUAL) {
        return false;
    }

    active_translation_ = translation;
    source_ = TranslationSource::PASTOR_VOICE;
    return true;
}

void SessionState::setOperatorTranslation(const std::string& translation) {
    std::lock_guard<std::mutex> lock(mutex_);
    active_translation_ = translation;
    source_ = TranslationSource::OPERATOR_MANUAL;
}

void SessionState::resetToDefault() {
    std::lock_guard<std::mutex> lock(mutex_);
    active_translation_ = default_translation_;
    source_ = TranslationSource::CONFIG;
}

bool SessionState::isOperatorLocked() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return source_ == TranslationSource::OPERATOR_MANUAL;
}
