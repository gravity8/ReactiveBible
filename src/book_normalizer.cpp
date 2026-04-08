#include "book_normalizer.h"
#include <algorithm>
#include <cctype>
#include <unordered_map>
#include <unordered_set>

const std::vector<std::string>& BookNormalizer::canonicalBooks() {
    static const std::vector<std::string> books = {
        "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
        "Joshua", "Judges", "Ruth",
        "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
        "1 Chronicles", "2 Chronicles",
        "Ezra", "Nehemiah", "Esther",
        "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
        "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
        "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
        "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
        "Matthew", "Mark", "Luke", "John",
        "Acts", "Romans",
        "1 Corinthians", "2 Corinthians",
        "Galatians", "Ephesians", "Philippians", "Colossians",
        "1 Thessalonians", "2 Thessalonians",
        "1 Timothy", "2 Timothy", "Titus", "Philemon",
        "Hebrews", "James",
        "1 Peter", "2 Peter",
        "1 John", "2 John", "3 John",
        "Jude", "Revelation"
    };
    return books;
}

std::string BookNormalizer::toLower(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) out += std::tolower(static_cast<unsigned char>(c));
    return out;
}

int BookNormalizer::editDistance(const std::string& a, const std::string& b) {
    std::string la = toLower(a);
    std::string lb = toLower(b);

    int m = static_cast<int>(la.size());
    int n = static_cast<int>(lb.size());

    std::vector<std::vector<int>> dp(m + 1, std::vector<int>(n + 1));

    for (int i = 0; i <= m; i++) dp[i][0] = i;
    for (int j = 0; j <= n; j++) dp[0][j] = j;

    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            int cost = (la[i-1] == lb[j-1]) ? 0 : 1;
            dp[i][j] = std::min({
                dp[i-1][j] + 1,
                dp[i][j-1] + 1,
                dp[i-1][j-1] + cost
            });
        }
    }
    return dp[m][n];
}

std::string BookNormalizer::soundex(const std::string& input) {
    if (input.empty()) return "";

    // Strip leading number+space for books like "1 Samuel".
    std::string s = input;
    std::string prefix;
    if (s.size() >= 2 && std::isdigit(s[0]) && s[1] == ' ') {
        prefix = s.substr(0, 2);
        s = s.substr(2);
    }

    if (s.empty()) return prefix;

    // Soundex encoding.
    static const int codes[26] = {
     // A  B  C  D  E  F  G  H  I  J  K  L  M  N  O  P  Q  R  S  T  U  V  W  X  Y  Z
        0, 1, 2, 3, 0, 1, 2, 0, 0, 2, 2, 4, 5, 5, 0, 1, 2, 6, 2, 3, 0, 1, 0, 2, 0, 2
    };

    std::string result;
    result += std::toupper(static_cast<unsigned char>(s[0]));

    int lastCode = -1;
    char c0 = std::toupper(static_cast<unsigned char>(s[0]));
    if (c0 >= 'A' && c0 <= 'Z') lastCode = codes[c0 - 'A'];

    for (size_t i = 1; i < s.size() && result.size() < 6; i++) {
        char c = std::toupper(static_cast<unsigned char>(s[i]));
        if (c < 'A' || c > 'Z') continue;

        int code = codes[c - 'A'];
        if (code != 0 && code != lastCode) {
            result += ('0' + code);
        }
        lastCode = code;
    }

    while (result.size() < 6) result += '0';
    return prefix + result;
}

// Mutable aliases map — initialized with built-in Whisper garbles,
// extended at runtime by pastor profiles via addAliases().
static std::unordered_map<std::string, std::string>& getMutableAliases() {
    static std::unordered_map<std::string, std::string> aliases = {
        // Whisper garbles observed in testing
        {"ex-sudos", "Exodus"}, {"x2dos", "Exodus"}, {"exodos", "Exodus"},
        {"exedus", "Exodus"}, {"exidus", "Exodus"},
        {"abakuk", "Habakkuk"}, {"abba kook", "Habakkuk"}, {"habakuk", "Habakkuk"},
        {"habbakuk", "Habakkuk"}, {"habacuc", "Habakkuk"},
        {"aizia", "Isaiah"}, {"izaiah", "Isaiah"}, {"isiah", "Isaiah"},
        {"revolution", "Revelation"}, {"revelations", "Revelation"},
        {"revelacion", "Revelation"},
        {"philippine", "Philippians"}, {"philippians", "Philippians"},
        {"filipino", "Philippians"}, {"phillipians", "Philippians"},
        {"philemon", "Philemon"}, {"feel a man", "Philemon"},
        {"filemon", "Philemon"},
        {"genisis", "Genesis"}, {"jennesis", "Genesis"},
        {"deuteranomy", "Deuteronomy"}, {"duderonomy", "Deuteronomy"},
        {"deuteronamy", "Deuteronomy"},
        {"levitikus", "Leviticus"}, {"levidicus", "Leviticus"},
        {"eclesiastes", "Ecclesiastes"}, {"ecclesiasties", "Ecclesiastes"},
        {"thessolonians", "1 Thessalonians"}, {"thesselonians", "1 Thessalonians"},
        {"colosians", "Colossians"}, {"colossions", "Colossians"},
        {"colossian", "Colossians"}, {"colosian", "Colossians"},
        {"galations", "Galatians"}, {"galatians", "Galatians"},
        {"galosians", "Galatians"}, {"galatian", "Galatians"},
        {"galacians", "Galatians"}, {"galosian", "Galatians"},
        {"galatia", "Galatians"}, {"gelation", "Galatians"},
        {"gelations", "Galatians"}, {"galician", "Galatians"},
        {"glacian", "Galatians"}, {"glacians", "Galatians"},
        {"efesians", "Ephesians"}, {"ephesions", "Ephesians"},
        {"ephesian", "Ephesians"}, {"ephesion", "Ephesians"},
        {"hebrews", "Hebrews"}, {"hebrew", "Hebrews"},
        {"lamentacion", "Lamentations"}, {"lamentashions", "Lamentations"},
        {"zepheniah", "Zephaniah"}, {"zecharaya", "Zechariah"},
        {"obediah", "Obadiah"}, {"obadaya", "Obadiah"},
        {"naham", "Nahum"}, {"nehimiah", "Nehemiah"},
        {"mathew", "Matthew"}, {"mathews", "Matthew"},
        {"proverb", "Proverbs"}, {"psalm", "Psalms"},
        {"psalms", "Psalms"}, {"songs", "Song of Solomon"},
        {"song of songs", "Song of Solomon"},
        // Acts — Whisper often garbles or hesitates on this short name
        {"acts of the apostles", "Acts"}, {"act", "Acts"},
        {"axe", "Acts"}, {"ax", "Acts"}, {"acks", "Acts"},
        // Romans — common garbles
        {"roman", "Romans"}, {"romain", "Romans"}, {"romane", "Romans"},
        // John — garbles
        {"jon", "John"}, {"johm", "John"},
        // James
        {"jame", "James"}, {"jams", "James"},
        // Mark
        {"marc", "Mark"},
        // Luke
        {"luc", "Luke"}, {"luk", "Luke"},
        // Common abbreviations
        {"gen", "Genesis"}, {"exo", "Exodus"}, {"lev", "Leviticus"},
        {"num", "Numbers"}, {"deut", "Deuteronomy"}, {"josh", "Joshua"},
        {"judg", "Judges"}, {"sam", "1 Samuel"}, {"chr", "1 Chronicles"},
        {"neh", "Nehemiah"}, {"est", "Esther"}, {"psa", "Psalms"},
        {"pro", "Proverbs"}, {"ecc", "Ecclesiastes"}, {"isa", "Isaiah"},
        {"jer", "Jeremiah"}, {"lam", "Lamentations"}, {"eze", "Ezekiel"},
        {"dan", "Daniel"}, {"hos", "Hosea"}, {"joe", "Joel"},
        {"amo", "Amos"}, {"oba", "Obadiah"}, {"jon", "Jonah"},
        {"mic", "Micah"}, {"nah", "Nahum"}, {"hab", "Habakkuk"},
        {"zep", "Zephaniah"}, {"hag", "Haggai"}, {"zec", "Zechariah"},
        {"mal", "Malachi"}, {"mat", "Matthew"}, {"mrk", "Mark"},
        {"luk", "Luke"}, {"joh", "John"}, {"rom", "Romans"},
        {"cor", "1 Corinthians"}, {"gal", "Galatians"}, {"eph", "Ephesians"},
        {"phi", "Philippians"}, {"col", "Colossians"}, {"thes", "1 Thessalonians"},
        {"tim", "1 Timothy"}, {"tit", "Titus"}, {"phm", "Philemon"},
        {"heb", "Hebrews"}, {"jas", "James"}, {"pet", "1 Peter"},
        {"jud", "Jude"}, {"rev", "Revelation"},
    };
    return aliases;
}

void BookNormalizer::addAliases(const std::unordered_map<std::string, std::string>& extra) {
    auto& aliases = getMutableAliases();
    for (const auto& [key, val] : extra) {
        aliases[key] = val;
    }
}

std::optional<std::string> BookNormalizer::normalize(const std::string& input) {
    if (input.empty()) return std::nullopt;

    const auto& books = canonicalBooks();
    const auto& aliases = getMutableAliases();

    std::string lower = toLower(input);

    // Step 0: reject common English words that are NOT Bible books.
    // These cause false positives via edit distance matching.
    static const std::unordered_set<std::string> rejectWords = {
        // 2-3 letter words that fuzzy-match short book names (Job, Joel, Amos, Jude)
        "so", "do", "go", "no", "if", "or", "an", "as", "at", "be", "by",
        "in", "is", "it", "my", "of", "on", "to", "up", "us", "we", "he",
        "me", "am", "oh", "ok", "ah", "um", "did", "got", "joy",
        "lot", "way", "day", "may", "can", "run", "set", "end", "own",
        "big", "ask", "try", "use", "few", "far", "yet", "ago", "due",
        // 4+ letter common English words
        "read", "new", "old", "the", "and", "for", "but", "not", "you",
        "are", "was", "has", "had", "his", "her", "him", "all", "one",
        "man", "men", "god", "lord", "say", "said", "come", "like",
        "just", "now", "let", "get", "put", "see", "too", "how",
        "good", "make", "made", "take", "gave", "give", "will",
        "this", "that", "with", "from", "them", "they", "been",
        "have", "here", "there", "what", "when", "who", "why",
        "your", "more", "than", "then", "also", "even", "much",
        "very", "some", "many", "most", "only", "over", "such",
        "word", "life", "time", "love", "holy", "pray", "amen",
        "open", "keep", "know", "tell", "talk", "walk", "work",
        "seed", "form", "born", "last", "next", "back", "down",
        "look", "call", "same", "went", "part", "help", "kind",
        "does", "done", "must", "well", "still", "point", "about",
        "after", "being", "could", "every", "first", "found",
        "going", "great", "house", "large", "never", "other", "place",
        "right", "shall", "since", "small", "thing", "think", "those",
        "under", "verse", "where", "which", "while", "world", "would",
    };
    if (rejectWords.count(lower)) return std::nullopt;

    // Step 1: exact match (case-insensitive) against canonical names.
    for (const auto& book : books) {
        if (toLower(book) == lower) return book;
    }

    // Step 2: alias lookup.
    auto aliasIt = aliases.find(lower);
    if (aliasIt != aliases.end()) return aliasIt->second;

    // Step 3: prefix match (e.g., "Revel" → "Revelation").
    if (lower.size() >= 4) {
        for (const auto& book : books) {
            std::string lb = toLower(book);
            if (lb.substr(0, lower.size()) == lower) return book;
        }
    }

    // Step 4: combined edit distance + Soundex scoring.
    std::string inputSoundex = soundex(input);

    std::string bestMatch;
    int bestScore = 999;

    // Preserve leading number prefix for matching (e.g., "1 " or "2 ").
    std::string inputBase = input;
    std::string inputPrefix;
    if (inputBase.size() >= 2 && std::isdigit(inputBase[0]) && inputBase[1] == ' ') {
        inputPrefix = inputBase.substr(0, 2);
        inputBase = inputBase.substr(2);
    }

    // Threshold: allow edit distance proportional to input length.
    // Short names (<=5 chars): max 2 edits. Longer: max ~40% of length.
    int maxDist = std::max(2, static_cast<int>(inputBase.size()) * 4 / 10);

    for (const auto& book : books) {
        std::string bookBase = book;
        std::string bookPrefix;
        if (bookBase.size() >= 2 && std::isdigit(bookBase[0]) && bookBase[1] == ' ') {
            bookPrefix = bookBase.substr(0, 2);
            bookBase = bookBase.substr(2);
        }

        // If input has a number prefix, only match books with the same prefix.
        if (!inputPrefix.empty() && inputPrefix != bookPrefix) continue;
        // If input has no prefix, skip numbered books unless the base name matches well.
        if (inputPrefix.empty() && !bookPrefix.empty()) continue;

        int ed = editDistance(inputBase, bookBase);

        // Soundex bonus: reduce score if phonetically similar.
        // Only apply when raw edit distance is already within threshold —
        // prevents "that's" (T320) matching "Titus" (T320) at ed=3.
        std::string bookSoundex = soundex(book);
        int soundexBonus = (inputSoundex == bookSoundex && ed <= maxDist) ? 2 : 0;

        int score = ed - soundexBonus;

        if (score < bestScore) {
            bestScore = score;
            bestMatch = book;
        }
    }

    if (bestScore <= maxDist && !bestMatch.empty()) {
        return bestMatch;
    }

    return std::nullopt;
}
