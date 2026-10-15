# Installing OMNI AI

Current version: 0.2.0. Get the apps from the repository's Releases page.

## Downloads

| Device | File |
| --- | --- |
| Mac (Apple silicon: M1 or newer) | `OMNI-AI-…-mac-arm64.dmg` |
| Windows 10 or 11 (64-bit) | `OMNI-AI-…-windows-x64-setup.exe` |
| Android 7 or newer | `OMNI-AI-…-android.apk` |

All three apps need an **OpenRouter API key** (openrouter.ai/keys). Add it in **Settings** the first time; the chat shows a setup card until you do.

## Mac

1. Open the `.dmg` and drag **OMNI AI** into Applications.
2. The app is not signed. If macOS says it is "damaged" or from an unidentified developer, open Terminal and run `xattr -cr "/Applications/OMNI AI.app"`, then open it again. (Or: System Settings, Privacy & Security, Open Anyway.)
3. The first start takes a few seconds while it sets up its own database. Then add your key in Settings.
4. Data: `~/Library/Application Support/OMNI AI`. Log: `omni.log` in that folder.
5. Apple silicon only. Intel Macs are not supported by this build.

## Windows

1. Run the `-setup.exe`. If SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**.
2. Pick an install folder if you like, then open OMNI AI from the Start menu. The first start takes a few seconds.
3. Data: `%APPDATA%\OMNI AI`. Log: `omni.log` in that folder.
4. If it won't start, close it fully (end "OMNI AI" in Task Manager) and start it again. If Windows Firewall asks, allow local (private) access only; the app only talks to your own computer.

## Android

The phone app does not contain the server. It opens an OMNI server that you run.

1. Run OMNI on a computer or server (`npm run build && npm start`, or Docker; see the README) with a PostgreSQL database. Hosted ones such as Supabase work; use the direct or session connection, not the transaction pooler.
2. On your phone, open the `.apk`. Allow **Install unknown apps** for your browser or file manager when asked.
3. Open OMNI AI and enter your server's address, for example `https://omni.example.com`. Use https if the server is reachable from the internet, and set `OMNI_REQUIRE_LOGIN=1` on it so only you can get in.
4. The app is signed with a test key, so it can't update over an app installed from elsewhere. Uninstall first if installation fails.
5. Exports (PDF, Word and so on) don't download inside the app yet; open the server in a browser to export.

## Your data

The Mac and Windows apps keep everything on your computer in the data folder above. It holds the database and the key that encrypts your saved API keys. **Back it up** if your data matters; losing the key means re-entering saved keys.

## Not tested everywhere

Built automatically and not signed with a paid certificate. The Mac app was run on the developer's Mac. The Windows and Android apps were built by GitHub Actions but not run on real devices before release. The AI was tested with a stand-in model, not live OpenRouter. Please report problems as issues.
