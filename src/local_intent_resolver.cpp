#include "local_intent_resolver.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <sstream>
#include <cctype>
#include <unordered_map>

std::string LocalIntentResolver::toLower(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) out += std::tolower(static_cast<unsigned char>(c));
    return out;
}

LocalIntentResolver::BookMatch LocalIntentResolver::findBook(const std::string& text) {
    std::string lower = toLower(text);
    BookMatch result;

    // Check each canonical book against the text.
    // Try longest names first (e.g., "1 Corinthians" before "1 C").
    const auto& books = BookNormalizer::canonicalBooks();

    // Also check common spoken forms.
    static const std::vector<std::pair<std::string, std::string>> spokenForms = {
        {"first samuel", "1 Samuel"}, {"second samuel", "2 Samuel"},
        {"first kings", "1 Kings"}, {"second kings", "2 Kings"},
        {"first chronicles", "1 Chronicles"}, {"second chronicles", "2 Chronicles"},
        {"first corinthians", "1 Corinthians"}, {"second corinthians", "2 Corinthians"},
        {"first thessalonians", "1 Thessalonians"}, {"second thessalonians", "2 Thessalonians"},
        {"first timothy", "1 Timothy"}, {"second timothy", "2 Timothy"},
        {"first peter", "1 Peter"}, {"second peter", "2 Peter"},
        {"first john", "1 John"}, {"second john", "2 John"},
        {"third john", "3 John"},
        {"song of solomon", "Song of Solomon"},
        {"revelations", "Revelation"},
    };

    // Try spoken forms first (longer, more specific).
    for (const auto& [spoken, canonical] : spokenForms) {
        size_t pos = lower.find(spoken);
        if (pos != std::string::npos) {
            result.canonical = canonical;
            result.endPos = pos + spoken.size();
            result.found = true;
            return result;
        }
    }

    // Try canonical book names (case-insensitive).
    std::string bestMatch;
    size_t bestLen = 0;
    size_t bestEnd = 0;

    for (const auto& book : books) {
        std::string bookLower = toLower(book);
        size_t pos = lower.find(bookLower);
        if (pos != std::string::npos && bookLower.size() > bestLen) {
            // Verify word boundary at both START and END.
            bool atStart = (pos == 0) || !std::isalpha(static_cast<unsigned char>(lower[pos - 1]));
            size_t end = pos + bookLower.size();
            bool atEnd = (end >= lower.size());
            bool wordBoundary = atStart && (atEnd || !std::isalpha(static_cast<unsigned char>(lower[end])));
            if (wordBoundary) {
                bestMatch = book;
                bestLen = bookLower.size();
                bestEnd = end;
            }
        }
    }

    if (!bestMatch.empty()) {
        result.canonical = bestMatch;
        result.endPos = bestEnd;
        result.found = true;
        return result;
    }

    // Try book normalizer for garbled names.
    // Extract individual words and try normalizing each.
    std::istringstream iss(text);
    std::string word;
    size_t pos = 0;
    while (iss >> word) {
        size_t wordStart = text.find(word, pos);

        // Strip ALL non-alpha characters (handles "it's" → "its", "belief." → "belief").
        std::string clean;
        for (char c : word) {
            if (std::isalpha(static_cast<unsigned char>(c))) clean += c;
        }

        // Need at least 5 alpha chars for fuzzy matching — short book names
        // (Job, Joel, Amos, Ruth, Jude) are handled by exact substring match above.
        if (clean.size() >= 5 && !std::isdigit(static_cast<unsigned char>(clean[0]))) {
            auto normalized = BookNormalizer::normalize(clean);
            if (normalized.has_value()) {
                result.canonical = normalized.value();
                result.endPos = wordStart + word.size();
                result.found = true;
                return result;
            }
            // Try two-word combos (e.g., "1 Samuel" where "1" is separate).
            if (wordStart > 0 && std::isdigit(static_cast<unsigned char>(text[wordStart - 2]))) {
                std::string combo = text.substr(wordStart - 2, 2) + clean;
                normalized = BookNormalizer::normalize(combo);
                if (normalized.has_value()) {
                    result.canonical = normalized.value();
                    result.endPos = wordStart + word.size();
                    result.found = true;
                    return result;
                }
            }
        }
        pos = wordStart + word.size();
    }

    return result;
}

IntentResult LocalIntentResolver::tryVersePatterns(const std::string& text) {
    IntentResult result;
    std::string lower = toLower(text);

    // Find a book name first.
    auto book = findBook(text);
    if (!book.found) return result;

    // Get the text after the book name, stripping trailing punctuation
    // that Whisper adds (periods, commas, etc.) which break end-of-string patterns.
    std::string after = text.substr(book.endPos);
    while (!after.empty() && std::ispunct(static_cast<unsigned char>(after.back()))) {
        after.pop_back();
    }
    // Also strip punctuation stuck to numbers in the middle (e.g., "16." → "16")
    // by removing trailing dots/commas from each word-like token.
    for (size_t i = 0; i < after.size(); i++) {
        if (std::isdigit(static_cast<unsigned char>(after[i]))) {
            size_t j = i;
            while (j < after.size() && std::isdigit(static_cast<unsigned char>(after[j]))) j++;
            // If digit sequence is followed by punctuation then space/end, strip the punctuation.
            if (j < after.size() && std::ispunct(static_cast<unsigned char>(after[j])) &&
                (j + 1 >= after.size() || after[j + 1] == ' ')) {
                after.erase(j, 1);
            }
            i = j;
        }
    }

    // Pattern 1: "Book C:V" or "Book C.V" or "Book C, V" — e.g., "John 3:16", "Hebrews 2, 14"
    std::regex cvPattern(R"(\s*(\d+)\s*[:,\.]\s*(\d+))");
    std::smatch m;
    if (std::regex_search(after, m, cvPattern)) {
        result.intent = Intent::SHOW_VERSE;
        result.book = book.canonical;
        result.chapter = std::stoi(m[1].str());
        result.verse = std::stoi(m[2].str());
        result.confidence = 0.95f;
        return result;
    }

    // Pattern 2: "Book NNN" — merged numbers like "John 316" → 3:16
    std::regex mergedPattern(R"(\s*(\d{3,}))");
    if (std::regex_search(after, m, mergedPattern)) {
        std::string num = m[1].str();
        // Smart split: try chapter lengths to find the best split.
        // For 3-digit: first digit = chapter, rest = verse (3|16)
        // For 4-digit: try first 1 or 2 digits as chapter
        int chapter = 0, verse = 0;
        if (num.size() == 3) {
            chapter = std::stoi(num.substr(0, 1));
            verse = std::stoi(num.substr(1));
        } else if (num.size() == 4) {
            // Try 2-digit chapter first (e.g., "1015" → 10:15)
            chapter = std::stoi(num.substr(0, 2));
            verse = std::stoi(num.substr(2));
            if (verse == 0) {
                chapter = std::stoi(num.substr(0, 1));
                verse = std::stoi(num.substr(1));
            }
        }
        if (chapter > 0 && verse > 0) {
            result.intent = Intent::SHOW_VERSE;
            result.book = book.canonical;
            result.chapter = chapter;
            result.verse = verse;
            result.confidence = 0.8f;
            return result;
        }
    }

    // Pattern 3: "Book chapter N verse V" / "Book chapter N and verse V"
    std::regex chapterVersePattern(R"(\s*(?:chapter\s+)?(\d+)\s+(?:and\s+)?(?:verse\s+)(\d+))", std::regex::icase);
    if (std::regex_search(after, m, chapterVersePattern)) {
        result.intent = Intent::SHOW_VERSE;
        result.book = book.canonical;
        result.chapter = std::stoi(m[1].str());
        result.verse = std::stoi(m[2].str());
        result.confidence = 0.95f;
        return result;
    }

    // Pattern 4: "Book N N" — two space-separated numbers, e.g., "John 3 16" → 3:16
    // Whisper often omits the colon between chapter and verse.
    std::regex twoNumPattern(R"(\s*(\d+)\s+(\d+)\s*$)");
    if (std::regex_search(after, m, twoNumPattern)) {
        int ch = std::stoi(m[1].str());
        int v = std::stoi(m[2].str());
        if (ch > 0 && ch <= 150 && v > 0) {
            result.intent = Intent::SHOW_VERSE;
            result.book = book.canonical;
            result.chapter = ch;
            result.verse = v;
            result.confidence = 0.9f;
            return result;
        }
    }

    // Pattern 5: "Book chapter N" (no verse) — default to verse 1.
    std::regex chapterOnlyPattern(R"(\s*(?:chapter\s+)?(\d+)\s*$)", std::regex::icase);
    if (std::regex_search(after, m, chapterOnlyPattern)) {
        int ch = std::stoi(m[1].str());
        if (ch > 0 && ch <= 150) { // reasonable chapter range
            result.intent = Intent::SHOW_VERSE;
            result.book = book.canonical;
            result.chapter = ch;
            result.verse = 1;
            result.confidence = 0.7f;
            return result;
        }
    }

    // Pattern 5: "Book N" — single number, could be chapter.
    std::regex singleNumPattern(R"(\s+(\d{1,3})\b)");
    if (std::regex_search(after, m, singleNumPattern)) {
        int num = std::stoi(m[1].str());
        if (num > 0 && num <= 150) {
            result.intent = Intent::SHOW_VERSE;
            result.book = book.canonical;
            result.chapter = num;
            result.verse = 1;
            result.confidence = 0.6f;
            return result;
        }
    }

    return result;
}

IntentResult LocalIntentResolver::tryTranslationSwitch(const std::string& text) {
    IntentResult result;
    std::string lower = toLower(text);

    static const std::vector<std::pair<std::string, std::string>> translations = {
        {"king james", "KJV"}, {"kjv", "KJV"},
        {"new international", "NIV"}, {"niv", "NIV"},
        {"new living", "NLT"}, {"nlt", "NLT"},
        {"amplified classic", "AMPC"}, {"ampc", "AMPC"},
        {"amplified", "AMP"}, {"amp", "AMP"},
        {"new king james", "NKJV"}, {"nkjv", "NKJV"},
        {"the message", "MSG"}, {"msg", "MSG"},
        {"passion translation", "TPT"}, {"tpt", "TPT"},
        {"english standard", "ESV"}, {"esv", "ESV"},
        {"new american standard", "NASB"}, {"nasb", "NASB"},
    };

    // Look for translation mention with context clues.
    for (const auto& [phrase, code] : translations) {
        size_t pos = lower.find(phrase);
        if (pos == std::string::npos) continue;

        // Check for switch-context words nearby.
        bool hasContext = (lower.find("read") != std::string::npos ||
                          lower.find("switch") != std::string::npos ||
                          lower.find("in the") != std::string::npos ||
                          lower.find("from the") != std::string::npos ||
                          lower.find("let's") != std::string::npos ||
                          lower.find("give") != std::string::npos ||
                          lower.find("use ") != std::string::npos ||
                          lower.find("try ") != std::string::npos ||
                          lower.find("show") != std::string::npos ||
                          lower.find("want") != std::string::npos ||
                          lower.find("version") != std::string::npos ||
                          lower.find("translation") != std::string::npos);

        if (hasContext) {
            result.intent = Intent::CHANGE_TRANSLATION;
            result.translation = code;
            result.confidence = 0.9f;
            return result;
        }
    }

    return result;
}

IntentResult LocalIntentResolver::tryNavigation(const std::string& text,
                                                  const std::string& contextJson) {
    IntentResult result;
    std::string lower = toLower(text);

    // Parse context.
    std::string ctxBook;
    int ctxChapter = 0, ctxVerse = 0;
    try {
        auto ctx = nlohmann::json::parse(contextJson);
        if (ctx.contains("book")) ctxBook = ctx["book"].get<std::string>();
        if (ctx.contains("chapter")) ctxChapter = ctx["chapter"].get<int>();
        if (ctx.contains("verse")) ctxVerse = ctx["verse"].get<int>();
    } catch (...) {}

    if (ctxBook.empty() || ctxChapter == 0) return result;

    // "go to verse N" / "verse N" / "give me verse N" with no book — use context.
    std::regex verseOnlyPattern(R"(\bverse\s+(\d+)\b)", std::regex::icase);
    std::smatch m;
    if (std::regex_search(lower, m, verseOnlyPattern)) {
        // Make sure there's no book name in the text (would be a full reference instead).
        auto bookMatch = findBook(text);
        if (!bookMatch.found) {
            result.intent = Intent::SHOW_VERSE;
            result.book = ctxBook;
            result.chapter = ctxChapter;
            result.verse = std::stoi(m[1].str());
            result.confidence = 0.9f;
            return result;
        }
    }

    // "next verse" / "next one"
    if (lower.find("next verse") != std::string::npos ||
        lower.find("next one") != std::string::npos) {
        result.intent = Intent::SHOW_VERSE;
        result.book = ctxBook;
        result.chapter = ctxChapter;
        result.verse = ctxVerse + 1;
        result.confidence = 0.95f;
        return result;
    }

    // "previous verse" / "verse before" / "go back" (but not "go back to <book>")
    if (lower.find("previous verse") != std::string::npos ||
        lower.find("verse before") != std::string::npos ||
        (lower.find("go back") != std::string::npos &&
         lower.find("go back to") == std::string::npos)) {
        if (ctxVerse > 1) {
            result.intent = Intent::SHOW_VERSE;
            result.book = ctxBook;
            result.chapter = ctxChapter;
            result.verse = ctxVerse - 1;
            result.confidence = 0.95f;
            return result;
        }
    }

    // "next chapter"
    if (lower.find("next chapter") != std::string::npos) {
        result.intent = Intent::SHOW_VERSE;
        result.book = ctxBook;
        result.chapter = ctxChapter + 1;
        result.verse = 1;
        result.confidence = 0.95f;
        return result;
    }

    // "previous chapter"
    if (lower.find("previous chapter") != std::string::npos) {
        if (ctxChapter > 1) {
            result.intent = Intent::SHOW_VERSE;
            result.book = ctxBook;
            result.chapter = ctxChapter - 1;
            result.verse = 1;
            result.confidence = 0.95f;
            return result;
        }
    }

    return result;
}

IntentResult LocalIntentResolver::resolve(const std::string& windowText,
                                            const std::string& contextJson) {
    // Try in order of specificity.

    // 1. Full verse reference (book + chapter + verse).
    auto result = tryVersePatterns(windowText);
    if (result.intent == Intent::SHOW_VERSE && result.verse > 0) {
        std::cerr << "[local] Matched verse: " << result.book << " "
                  << result.chapter << ":" << result.verse << "\n";
        return result;
    }

    // 2. Navigation commands (verse N, next verse, go back, etc.)
    result = tryNavigation(windowText, contextJson);
    if (result.intent == Intent::SHOW_VERSE) {
        std::cerr << "[local] Matched navigation: " << result.book << " "
                  << result.chapter << ":" << result.verse << "\n";
        return result;
    }

    // 3. Translation switch.
    result = tryTranslationSwitch(windowText);
    if (result.intent == Intent::CHANGE_TRANSLATION) {
        std::cerr << "[local] Matched translation: " << result.translation.value() << "\n";
        return result;
    }

    // 4. Book + chapter only (no verse → default verse 1).
    if (result.intent == Intent::SHOW_VERSE && result.chapter > 0 && result.verse == 0) {
        result.verse = 1;
        return result;
    }

    // Nothing matched → IGNORE.
    return IntentResult{};
}
