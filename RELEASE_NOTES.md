## What's New in v1.0.8

### Bug Fix
- **Fixed crash on launch** — the v1.0.7 release was missing three new modules (profile-manager, profile-analyzer, calibration-worker) from the packaged app, causing "Cannot find module './profile-manager'" on startup

### Improvements
- **Packaging regression test** — added automated test that runs in CI before every build to verify all required modules are included in the packaged app
