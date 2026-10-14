Downloads for OMNI AI. Pick the one for your device.

| Device | File |
| --- | --- |
| Mac (Apple silicon: M1 or newer) | `OMNI-AI-…-mac-arm64.dmg` |
| Windows 10 or 11 (64-bit) | `OMNI-AI-…-windows-x64-setup.exe` |
| Android 7 or newer | `OMNI-AI-…-android.apk` |

**The Mac and Windows apps run everything on your computer.** They include their own database and server, and your data stays in the app's data folder. You add your own OpenRouter key in Settings.

**The Android app does not contain the server.** Phones can't run it, so the app opens an OMNI server that you run (a computer at home, a small server, or a host of your choice with a PostgreSQL database such as Supabase). Enter its address the first time you open the app. If the server can be reached from the internet, use https and set `OMNI_REQUIRE_LOGIN=1` on it.

## These apps are not signed

They are built automatically and are not signed with a paid developer certificate, so your computer will warn you the first time.

- **Mac:** open the `.dmg` and drag OMNI AI to Applications. If macOS says the app is damaged or from an unidentified developer, open Terminal and run `xattr -cr "/Applications/OMNI AI.app"`, then open it again. (Or: System Settings, Privacy & Security, then Open Anyway.)
- **Windows:** if SmartScreen says "Windows protected your PC", choose More info, then Run anyway.
- **Android:** allow "Install unknown apps" for your browser or file manager when asked. The APK is signed with a test key, so it can't update an app installed from another source. Uninstall first if installation fails.

## Where the desktop app keeps your data

- Mac: `~/Library/Application Support/OMNI AI`
- Windows: `%APPDATA%\OMNI AI`

Back this folder up if your data matters. It holds the database and the key that encrypts your saved API keys; losing the key means entering saved keys again.

Not tested on real Windows or Android devices before release. Please report problems as issues.
