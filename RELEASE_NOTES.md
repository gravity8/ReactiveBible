## What's New in v1.0.9

### Bug Fix
- **Fixed calibration crash** — replaced missing `uuid` npm package with built-in `crypto.randomUUID()`

### Improvements
- **Comprehensive pre-deployment tests** — `npm test` now runs 62 checks covering npm dependencies, C++ binary startup, Whisper model, Bible translations, config validation, and build assets
