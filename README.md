# ReactiveBible

Real-time sermon verse detection and display. Listens to a live sermon via microphone, detects Bible verse references using speech-to-text and AI, and displays them on screen instantly -- on a projector, any browser on the same WiFi, OBS, vMix, or any device.

Built for churches, conferences, and Bible study groups where a pastor or speaker references scripture and the congregation needs to see it in real time.

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Starting the App](#starting-the-app)
  - [Operator Workflow](#operator-workflow)
  - [Display Outputs](#display-outputs)
  - [Themes](#themes)
  - [Translation Switching](#translation-switching)
  - [Collaboration / Multi-Operator Sessions](#collaboration--multi-operator-sessions)
- [Detection Modes](#detection-modes)
- [Supported Translations](#supported-translations)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Building for Distribution](#building-for-distribution)
- [Auto-Update](#auto-update)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Live verse detection** -- Whisper speech-to-text with AI-powered intent resolution detects verse references as the pastor speaks them
- **10 Bible translations bundled offline** -- KJV, NIV, NLT, AMP, AMPC, NKJV, MSG, TPT, ESV, NASB (plus online fetch for others)
- **Voice-activated translation switching** -- say "give me the NLT" or "read that in the Amplified" and the display updates
- **Multiple display outputs** -- local projector window, network display (any browser on WiFi), OBS Browser Source, vMix Web Browser input
- **10 built-in themes** -- Midnight, Ember, Ocean, Royal, Eden, Sanctuary, Alabaster, Crimson, Slate, Aurora
- **Custom background images** -- drag-and-drop or file picker
- **Preview before live** -- operator reviews detected verses before sending to the audience
- **Auto-live mode** -- bypass manual review and send verses straight to display
- **Verse queue** -- hold verses for later and send them when ready
- **Multi-operator collaboration** -- host a session, invite other operators to join via IP + PIN, transfer host role between operators
- **Offline mode** -- works without internet using local regex pattern matching and bundled Bible data
- **Online mode** -- Groq LLM (llama-3.1-8b) for better accuracy with accented speech, garbled STT, and ambiguous references
- **Hallucination filtering** -- detects and suppresses Whisper hallucinations (repetitive text, YouTube phrases, prompt echoes)
- **Silence detection** -- skips silent audio chunks to avoid false detections
- **Deduplication** -- prevents the same verse from being detected repeatedly within a configurable window
- **Auto-update** -- checks GitHub Releases on launch and installs updates on next restart

---

## How It Works

```
                                    ReactiveBible Architecture

  Microphone                                                          Display Outputs
  (48kHz)                                                            +-----------------+
     |                                                               | Projector       |
     v                                                               | (Display Window)|
  Electron Renderer                                                  +-----------------+
  (Web Audio API)                                                    +-----------------+
     |                                                               | Any Browser     |
     | PCM audio via IPC                                             | (Network URL)   |
     v                                                               +-----------------+
  Electron Main Process                                              +-----------------+
     |                                                               | OBS / vMix      |
     v                                                               | (Browser Source) |
  ffmpeg (resample 48kHz -> 16kHz mono)                              +-----------------+
     |                                                                      ^
     v                                                                      |
  C++ Detector Binary (sermon-verse-detector)                               |
     |                                                                      |
     +-- Whisper STT (3-second chunks, ggml-small.en model)                 |
     |                                                                      |
     +-- Intent Resolver                                                    |
     |     +-- Local regex (instant, <1ms)                                  |
     |     +-- Groq LLM fallback (online mode, ~500ms)                     |
     |                                                                      |
     +-- Verse Fetch                                                        |
     |     +-- Bundled JSON (offline, instant)                              |
     |     +-- YouVersion scrape (online, ~1-2s on cache miss)              |
     |                                                                      |
     +-- JSON stdout --> Electron IPC --> React UI --> Display Window -------+
                                                  |
                                                  +--> Network Display (WebSocket)
                                                  +--> Collaboration Sync (WebSocket)
```

1. **Audio capture** -- The Electron renderer captures microphone audio at 48kHz using the Web Audio API
2. **Resampling** -- Audio is sent via IPC to the main process, which pipes it through ffmpeg to resample to 16kHz mono (what Whisper expects)
3. **Speech-to-text** -- The C++ detector binary runs Whisper inference on 3-second audio chunks, producing text segments
4. **Intent resolution** -- Each text segment is analyzed by a two-tier resolver:
   - **Local regex** (always runs first) -- instant pattern matching for verse references like "John 3:16", "Genesis chapter 1 verse 2", and translation switches
   - **Groq LLM** (online mode fallback) -- handles garbled speech, accented pronunciation, ambiguous references
5. **Verse fetch** -- Once a reference is resolved, the verse text is fetched from bundled JSON files (instant) or scraped from YouVersion (cache miss)
6. **Display** -- The verse appears in the operator's preview panel. The operator sends it to live, which pushes it to all display outputs simultaneously

---

## Prerequisites

| Dependency | Install | Purpose |
|------------|---------|---------|
| **macOS** 12+ | -- | Apple Silicon or Intel |
| **Xcode Command Line Tools** | `xcode-select --install` | C++ compiler |
| **CMake** | `brew install cmake` | Build system for the C++ detector |
| **ffmpeg** | `brew install ffmpeg` | Audio resampling (48kHz to 16kHz) |
| **Node.js** >= 18 | `brew install node` | Electron app runtime |
| **Whisper model** | See below | Speech-to-text model |

### Downloading a Whisper Model

```bash
mkdir -p models && cd models

# Small (recommended for live sermons -- better accuracy with accented speech)
curl -LO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
# 465 MB, ~0.8s inference per 3s chunk

# Base (lighter alternative -- faster but less accurate)
curl -LO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
# 141 MB, ~0.3s inference per 3s chunk
```

---

## Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd reactivebible

# 2. Set up environment variables
cp .env.example .env
# Edit .env and add your API keys (see Configuration section)

# 3. Build the C++ detector
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build

# 4. Install Electron app dependencies
cd app
npm install

# 5. Run in development mode
npm run dev
```

The app opens two processes:
- **Vite dev server** at `http://localhost:5173` (hot-reloading React UI)
- **Electron** window loading the Vite dev server

---

## Configuration

### Environment Variables (`.env`)

Stored in the project root. **Never committed to git.**

```bash
# Required for online mode (Groq LLM-based intent resolution)
# Get a free key at https://console.groq.com
GROQ_API_KEY=gsk_your_key_here

# Optional -- for fetching translations via API.Bible
# Get a free key at https://scripture.api.bible
API_BIBLE_KEY_1=your_key_here
API_BIBLE_KEY_2=your_second_key_here
```

### Config File (`config.json`)

Located in the project root. Controls detector behavior.

```json
{
  "mode": "offline",
  "default_translation": "KJV",
  "l1_translations": ["KJV", "NIV", "NLT", "AMP", "AMPC", "NKJV", "MSG", "TPT"],
  "whisper_model_path": "./models/ggml-small.en.bin",
  "dedup_window_seconds": 8,
  "sliding_window_size": 10,
  "debounce_ms": 100
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `"offline"` | `"online"` uses Groq LLM for better accuracy. `"offline"` uses local regex only (no internet needed). |
| `default_translation` | `"KJV"` | Default Bible translation code |
| `l1_translations` | `["KJV", ...]` | Translations to pre-load into memory on startup |
| `whisper_model_path` | `"./models/ggml-small.en.bin"` | Path to the Whisper model binary |
| `dedup_window_seconds` | `8` | Suppress duplicate verse detections within this many seconds |
| `sliding_window_size` | `10` | Number of words in the sliding text window for intent resolution |
| `debounce_ms` | `100` | Minimum milliseconds between intent resolution calls |
| `api_bible_accounts` | `[]` | API.Bible account keys mapped to translations (uses `env_key` to reference `.env` variables) |

---

## Usage

### Starting the App

```bash
cd app
npm run dev
```

### Operator Workflow

The operator interface has several panels:

```
+--------------------------------------------------------------+
| Session Bar (host/join, connected clients, transfer host)    |
+--------------------------------------------------------------+
| Header (settings, mode toggle, display outputs)              |
+-------------------+-------------------+-----------+----------+
| Live Transcript   | Preview Panel     | Live      | Queue    |
| (Whisper output)  | (review before    | Display   | (held   |
|                   |  sending to live) | Panel     |  verses) |
+-------------------+-------------------+-----------+----------+
| Search Scripture                      | Recent Detections    |
| (manual verse lookup)                 | (detection history)  |
+---------------------------------------+----------------------+
```

1. **Start transcribing** -- click the green "Start transcribing" button in the transcript panel
2. **Verse detected** -- when the pastor says a verse reference, it appears in the Preview Panel
3. **Review** -- check the verse is correct
4. **Send to live** -- click "Send to Live" or enable "Auto-live" to skip manual review
5. **Clear screen** -- click "Clear screen" to remove the verse from display

### Display Outputs

Click the **monitor icon** in the header to open display options:

| Output | How to Use |
|--------|-----------|
| **Display Window** | Opens a frameless window. Drag to a projector or second monitor. Can also be captured with OBS "Window Capture". |
| **Network Display** | Starts an HTTP + WebSocket server on port 3001. Open the URL (e.g., `http://192.168.1.5:3001`) on any device on the same WiFi -- phones, tablets, smart TVs, laptops. |
| **OBS Studio** | Use Display Window as "Window Capture", or Network Display URL as "Browser Source". |
| **vMix** | Add Input > Web Browser > paste the Network Display URL. Set resolution to 1920x1080. |

Multiple devices can connect to the Network Display simultaneously. They all receive the same verse in real time.

### Themes

Click the **Theme** button in the Live Display panel header to choose from 10 built-in themes:

| Theme | Description |
|-------|-------------|
| **Midnight** | Black background, teal accents (default) |
| **Ember** | Warm dark amber with gold tones |
| **Ocean** | Deep navy blue with sky blue accents |
| **Royal** | Deep purple with lavender accents |
| **Eden** | Dark forest green with bright green |
| **Sanctuary** | Warm earthy brown with gold, serif font |
| **Alabaster** | Light mode -- cream background, stone accents |
| **Crimson** | Dark red with rose accents |
| **Slate** | Neutral gray-blue, understated |
| **Aurora** | Dark with cyan/teal gradient accents |

Themes apply to both the Display Window and all Network Display clients. Custom background images overlay on top of themes.

### Translation Switching

**By voice** -- the pastor can say:
- "Give me the NLT" / "give us NLT"
- "Read that in the Amplified"
- "Switch to ESV" / "use the NKJV"
- "New Living Translation" / "King James Version"

**From the UI** -- use the translation dropdown in the header.

Translations not available locally are fetched online from YouVersion on demand and cached.

### Collaboration / Multi-Operator Sessions

Multiple operators can control the same display simultaneously.

**Starting a session (host):**
1. Click **"Host Session"** in the session bar
2. Enter your name and click "Start Session"
3. Share the **IP address** and **4-digit PIN** with other operators

**Joining a session (client):**
1. Click **"Join Session"** in the session bar
2. Enter the host's IP, PIN, and your name
3. Click "Connect"

**Transferring host role:**
- The host sees a **"Make Host"** button next to each connected client
- Click it > Confirm > the selected client becomes the new host
- The same PIN is reused so other clients reconnect automatically
- Useful when the original host drops off and a client is auto-promoted, then the original host comes back

**Auto-promotion:**
- If the host drops off (network issue, crash), a connected client is automatically promoted to host after 1.5 seconds
- A toast notification confirms the promotion

---

## Detection Modes

### Offline Mode (`"mode": "offline"`)

- Uses **local regex pattern matching** only
- No internet connection required
- Instant detection (<1ms)
- Handles standard verse patterns: "John 3:16", "Genesis chapter 1 verse 2", "John 3 16", "Romans 316"
- Handles translation switches: "give me NLT", "switch to AMPC"
- Less accurate with garbled speech or unusual phrasing

### Online Mode (`"mode": "online"`)

- Local regex runs first (instant)
- Falls back to **Groq LLM** (llama-3.1-8b-instant) when regex doesn't match or has low confidence
- Better accuracy with accented speech, garbled STT, and ambiguous references
- Handles things like "Ruman Zontu" -> "Romans" (Nigerian accent correction)
- Requires `GROQ_API_KEY` in `.env`
- ~500ms latency for the LLM call
- Automatic rate-limit backoff (15s cooldown)
- Falls back to local result if Groq fails

You can switch modes from Settings in the app without restarting.

---

## Supported Translations

### Bundled Offline (instant lookup)

| Code | Translation | Verses |
|------|------------|--------|
| KJV | King James Version | 31,102 |
| NIV | New International Version | 31,089 |
| NLT | New Living Translation | 31,040 |
| AMP | Amplified Bible | 31,103 |
| NKJV | New King James Version | 31,102 |

### Available Online (fetched from YouVersion on demand)

AMPC, MSG, TPT, ESV, NASB, CSB, CEV, GNT, ICB, ASV, WEB, YLT, HCSB, NET

Online-fetched chapters are cached locally for instant access on subsequent lookups.

---

## Project Structure

```
reactivebible/
|-- .env                    # API keys (gitignored)
|-- .env.example            # Template for .env
|-- config.json             # Detector configuration
|-- config.example.json     # Template for config
|-- CMakeLists.txt          # C++ build configuration
|-- README.md
|
|-- src/                    # C++ source code
|   |-- main.cpp            # Audio capture, Whisper inference, processing loop
|   |-- pipeline.cpp/h      # Sliding window, intent dispatch, verse emission
|   |-- intent_resolver.cpp/h        # Groq LLM-based intent resolution
|   |-- local_intent_resolver.cpp/h  # Offline regex-based intent resolution
|   |-- context_resolver.cpp/h       # Conversation context tracking
|   |-- book_normalizer.cpp/h        # Fuzzy Bible book name matching
|   |-- api_fetch.cpp/h     # YouVersion verse scraping (C++ side)
|   |-- cache.cpp/h         # In-memory + disk verse cache
|   |-- session_state.cpp/h # Translation state (pastor voice vs operator manual)
|   |-- dedup.cpp/h         # Duplicate verse suppression
|   |-- output.cpp/h        # JSON output to stdout
|
|-- app/                    # Electron + React app
|   |-- main.js             # Electron main process (IPC, child processes, servers)
|   |-- preload.js          # Electron preload bridge (renderer <-> main)
|   |-- bible-fetcher.js    # YouVersion + BibleHub online fetcher (JS side)
|   |-- sync-server.js      # Collaboration WebSocket server
|   |-- sync-client.js      # Collaboration WebSocket client
|   |-- themes.cjs          # Built-in theme definitions (CommonJS)
|   |-- display.html        # Frameless display window (projector output)
|   |-- package.json        # App dependencies and electron-builder config
|   |
|   |-- src/
|       |-- main.jsx        # App bootstrap and IPC listener setup
|       |-- App.jsx          # Root React component
|       |-- themes.js        # Built-in theme definitions (ESM)
|       |-- index.css        # Global styles
|       |
|       |-- store/
|       |   |-- useStore.js  # Zustand state management
|       |
|       |-- hooks/
|       |   |-- useAudio.js  # Microphone capture hook
|       |
|       |-- components/
|           |-- Header.jsx           # App header (settings, mode, displays)
|           |-- TranscriptPanel.jsx  # Live Whisper transcript
|           |-- PreviewPanel.jsx     # Verse preview before live
|           |-- LiveDisplayPanel.jsx # Live display status + theme picker
|           |-- QueuePanel.jsx       # Held verses queue
|           |-- SearchScripture.jsx  # Manual verse search
|           |-- RecentDetections.jsx # Detection history
|           |-- DisplayOutputs.jsx   # Display output controls (window, network, vMix)
|           |-- SessionBar.jsx       # Collaboration session controls
|           |-- SettingsModal.jsx    # Settings dialog
|           |-- Toast.jsx            # Toast notifications
|
|-- bibles/                 # Bundled Bible translation JSON files
|   |-- kjv.json
|   |-- niv.json
|   |-- nlt.json
|   |-- amp.json
|   |-- nkjv.json
|
|-- models/                 # Whisper model files (gitignored)
|   |-- ggml-small.en.bin
|
|-- bible_cache/            # Cached online-fetched chapters (gitignored)
|
|-- third_party/            # whisper.cpp (gitignored, build-time dependency)
|   |-- whisper.cpp/
|
|-- build/                  # CMake build output (gitignored)
    |-- sermon-verse-detector
```

---

## Architecture

### Audio Pipeline

```
Microphone (48kHz) --> Electron renderer (Web Audio API, ScriptProcessor)
    --> IPC send (fire-and-forget, no round-trip)
    --> Electron main process
    --> ffmpeg stdin (resample to 16kHz mono float32)
    --> C++ detector stdin
    --> 3-second chunk buffer
    --> Silence detection (RMS < 0.01 = skip)
    --> Whisper inference (ggml-small.en, ~0.8s per chunk)
    --> Hallucination filter (repetition, YouTube phrases, prompt echoes, oversized output)
    --> Pipeline sliding window (10 words)
    --> Intent resolution (local regex -> Groq LLM fallback)
    --> Context resolution (merge partial references with history)
    --> Verse fetch (cache -> bundled JSON -> YouVersion scrape)
    --> Deduplication gate (8-second window)
    --> JSON stdout
    --> Electron IPC
    --> React UI (preview -> live -> display)
```

### IPC Flow

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `send-audio` | Renderer -> Main | PCM audio chunks (fire-and-forget, no Promise) |
| `verse-detected` | Main -> Renderer | Detected verse JSON |
| `transcript` | Main -> Renderer | Whisper transcript lines |
| `translation-changed` | Main -> Renderer | Voice-triggered translation switch |
| `send-to-display` | Renderer -> Main | Push verse to display window + network |
| `show-verse` | Main -> Display | Verse data for display rendering |
| `set-theme` | Main -> Display | Theme styles for display rendering |
| `start-network-display` | Renderer -> Main | Start HTTP + WebSocket server on port 3001 |

### Collaboration Protocol

```
Host (SyncServer on port 3000)
  |
  |-- Client connects via WebSocket
  |-- Client sends { type: "join", pin: "1234", name: "David" }
  |-- Host validates PIN
  |-- Host sends { type: "sync", state: {...}, clients: [...] }
  |
  |-- Client sends { type: "action", field: "liveVerse", value: {...} }
  |-- Host checks action lock (500ms mutex on critical fields)
  |-- Host broadcasts { type: "update", field: "liveVerse", value: {...} }
  |
  |-- Host transfer: { type: "become-host", state: {...}, pin: "1234" }
  |-- Heartbeat: ping/pong every 5s, timeout after 15s
```

---

## Building for Distribution

```bash
cd app

# macOS (.dmg)
npm run build:mac

# Windows (.exe via NSIS installer)
npm run build:win

# Linux (AppImage)
npm run build:linux
```

The build bundles:
- Electron runtime
- React app (Vite build)
- C++ detector binary
- Whisper model
- Bible JSON files
- Config file

### Code Signing (macOS)

Without code signing, macOS Gatekeeper will block the app. To sign and notarize:

1. Get an **Apple Developer account** ($99/year)
2. Set environment variables:
   ```
   CSC_LINK=path/to/certificate.p12
   CSC_KEY_PASSWORD=your_password
   APPLE_ID=your@apple.id
   APPLE_APP_SPECIFIC_PASSWORD=app-specific-password
   ```
3. Run `npm run build:mac` -- electron-builder handles signing and notarization automatically

---

## Auto-Update

The app uses `electron-updater` to check for updates on GitHub Releases.

### Setup

1. Edit `app/package.json` and set your GitHub owner/repo:
   ```json
   "publish": {
     "provider": "github",
     "owner": "your-github-username",
     "repo": "reactivebible"
   }
   ```

2. Create a GitHub Release and attach the built artifacts (.dmg, .exe, .AppImage)

3. On launch, the app checks for updates, downloads in the background, and installs on next restart

---

## Troubleshooting

### "Detector binary not found"

The C++ detector hasn't been built. Run:
```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

### "ffmpeg not found"

Install ffmpeg:
```bash
brew install ffmpeg     # macOS
sudo apt install ffmpeg # Linux
```

### "Microphone access denied"

- macOS: System Settings > Privacy & Security > Microphone > enable for the app
- If running in dev mode, Terminal/iTerm needs microphone permission too

### No microphone found

- Check that a microphone is connected
- Try selecting a different audio input in Settings

### Verse detection is slow

- The base latency is the 3-second audio chunk. Whisper needs this much audio for accurate transcription.
- In online mode, the Groq LLM adds ~500ms on cache miss.
- Make sure you're using the `ggml-small.en` model (not `base`) for better accuracy with fewer re-detections.

### Verse text is incomplete or has HTML

- Bundled translations (KJV, NIV, NLT, AMP, NKJV) are pre-cleaned and should be correct.
- Online-fetched translations (ESV, NASB, etc.) are scraped from YouVersion. Some translations with heavy cross-references may have incomplete text. Fetched chapters are cached, so clearing `bible_cache/` and re-fetching may help.

### Network Display not accessible

- Make sure both devices are on the same WiFi network
- Check that port 3001 isn't blocked by a firewall
- Try accessing `http://<your-ip>:3001` in a browser on the host machine first

### App crashes with "EPIPE" error

This has been fixed. If you see this on an older version, update to the latest. The fix adds error handlers on ffmpeg/detector stdin pipes and a global uncaught exception handler.

---

## License

All rights reserved.
