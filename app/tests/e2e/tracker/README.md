# Tracker e2e (empty for now)

Covers the tray menu (BUILD_PLAN §8.2) and the four prompt windows — StartPrompt, CheckinPrompt, IdlePrompt, RecoveryPrompt (§9) — plus `BucketPicker` (§10.3), which only appears inside those prompts. None of that UI exists yet.

Note for whoever writes the first test here: prompts are separate `BrowserWindow`s (`prompt.html`, routed by `?kind=`), not panels in the main window — `electronApp.ts`'s `launchApp()` only returns the main window today. Getting a prompt window will need `electronApp.app.waitForEvent('window')` (or similar) added to that helper.
