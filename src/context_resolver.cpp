#include "context_resolver.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <regex>

// ── Context serialization ────────────────────────────────

std::string ConversationContext::toJson() const {
    nlohmann::json j;
    if (!book.empty()) {
        j["book"] = book;
        j["chapter"] = chapter;
        j["verse"] = verse;
    }
    if (!translation.empty()) {
        j["translation"] = translation;
    }
    if (!history.empty()) {
        nlohmann::json hist = nlohmann::json::array();
        for (const auto& h : history) {
            hist.push_back({{"book", h.book}, {"chapter", h.chapter}, {"verse", h.verse}});
        }
        j["recent_history"] = hist;
    }
    return j.dump();
}

// ── Context resolution ───────────────────────────────────

ResolvedReference ContextResolver::resolve(const IntentResult& intent,
                                            const std::string& activeTranslation) {
    std::lock_guard<std::mutex> lock(mutex_);

    bool hasCtx = ctx_.hasReference() && !ctx_.isExpired();
    ResolvedReference ref;

    // The LLM already received context and should return complete references.
    // This merge is a safety net for partial LLM responses.

    // Book: intent > context
    if (!intent.book.empty()) {
        ref.book = intent.book;
    } else if (hasCtx) {
        ref.book = ctx_.book;
        std::cerr << "[context] Inherited book: " << ref.book << "\n";
    }

    // Chapter: intent > context (only carry if same book or no book in intent)
    if (intent.chapter > 0) {
        ref.chapter = intent.chapter;
    } else if (hasCtx && (intent.book.empty() || intent.book == ctx_.book)) {
        ref.chapter = ctx_.chapter;
        std::cerr << "[context] Inherited chapter: " << ref.chapter << "\n";
    }

    // Verse: intent > context (only carry if same book+chapter)
    if (intent.verse > 0) {
        ref.verse = intent.verse;
    } else if (hasCtx && ref.book == ctx_.book && ref.chapter == ctx_.chapter) {
        ref.verse = ctx_.verse;
        std::cerr << "[context] Inherited verse: " << ref.verse << "\n";
    }

    // Translation
    if (intent.translation.has_value() && !intent.translation->empty()) {
        ref.translation = intent.translation.value();
    } else {
        ref.translation = activeTranslation;
    }

    ref.valid = !ref.book.empty() && ref.chapter > 0 && ref.verse > 0;
    return ref;
}

void ContextResolver::update(const ResolvedReference& ref) {
    std::lock_guard<std::mutex> lock(mutex_);

    // Push to history before overwriting.
    if (ctx_.hasReference()) {
        ctx_.history.push_back({ctx_.book, ctx_.chapter, ctx_.verse});
        if (static_cast<int>(ctx_.history.size()) > MAX_HISTORY) {
            ctx_.history.erase(ctx_.history.begin());
        }
    }

    ctx_.book = ref.book;
    ctx_.chapter = ref.chapter;
    ctx_.verse = ref.verse;
    if (!ref.translation.empty()) {
        ctx_.translation = ref.translation;
    }
    ctx_.lastUpdated = std::chrono::steady_clock::now();
}

ConversationContext ContextResolver::getContext() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return ctx_;
}

void ContextResolver::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    ctx_ = ConversationContext{};
    std::cerr << "[context] Cleared\n";
}

// ── Shortcuts ────────────────────────────────────────────

static std::string toLower(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) out += std::tolower(static_cast<unsigned char>(c));
    return out;
}

std::optional<ResolvedReference> ContextResolver::tryShortcut(
        const std::string& windowText, const std::string& activeTranslation) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!ctx_.hasReference() || ctx_.isExpired()) return std::nullopt;

    std::string text = toLower(windowText);

    ResolvedReference ref;
    ref.book = ctx_.book;
    ref.chapter = ctx_.chapter;
    ref.verse = ctx_.verse;
    ref.translation = activeTranslation;
    ref.fromShortcut = true;

    // "next verse"
    if (text.find("next verse") != std::string::npos ||
        text.find("next one") != std::string::npos) {
        ref.verse = ctx_.verse + 1;
        ref.valid = true;
        std::cerr << "[shortcut] next verse -> " << ref.book << " "
                  << ref.chapter << ":" << ref.verse << "\n";
        return ref;
    }

    // "previous verse" / "go back"
    if (text.find("previous verse") != std::string::npos ||
        text.find("verse before") != std::string::npos ||
        (text.find("go back") != std::string::npos &&
         text.find("go back to") == std::string::npos)) {
        if (ctx_.verse > 1) {
            ref.verse = ctx_.verse - 1;
            ref.valid = true;
            std::cerr << "[shortcut] previous verse -> " << ref.book << " "
                      << ref.chapter << ":" << ref.verse << "\n";
            return ref;
        }
        return std::nullopt;
    }

    // "next chapter"
    if (text.find("next chapter") != std::string::npos) {
        ref.chapter = ctx_.chapter + 1;
        ref.verse = 1;
        ref.valid = true;
        std::cerr << "[shortcut] next chapter -> " << ref.book << " "
                  << ref.chapter << ":1\n";
        return ref;
    }

    // "previous chapter"
    if (text.find("previous chapter") != std::string::npos) {
        if (ctx_.chapter > 1) {
            ref.chapter = ctx_.chapter - 1;
            ref.verse = 1;
            ref.valid = true;
            std::cerr << "[shortcut] previous chapter -> " << ref.book << " "
                      << ref.chapter << ":1\n";
            return ref;
        }
        return std::nullopt;
    }

    return std::nullopt;
}
