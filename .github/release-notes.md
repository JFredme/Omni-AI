# OMNI AI 0.3.2: a smoother phone experience

- Pages now fit phone screens: nothing runs off the edge, buttons are easier to tap, and the keyboard no longer covers the message box.
- No more accidental zooming or pull-down refresh.
- The "Can't reach your server" screen now fits the screen and shows the address it tried.
- Simpler wording on the API key card.

# 0.3.1

**Fix:** the Android app showed "Can't reach your server" when connecting to a computer's phone access, even though the connection worked. The computer's code page now loads normally. Update the Mac or Windows app to 0.3.1 (the Android app itself is unchanged).

# 0.3.0: connect your phone

**New in 0.3.0:** the Mac and Windows apps can now serve your phone. Choose **Phone → Connect your phone…**, turn it on, and type the address and 6-digit code into the Android app. The Android app also now accepts a plain address like `192.168.1.20:47832`. (0.2.0 brought the chat-first redesign below.)

## The chat-first redesign (0.2.0)

OMNI now opens on one polished chat. Everything else (tasks, notes, projects, agents, calendar, research, code, documents, automations, analytics) is still there, tucked under **Workspace** in the sidebar and reachable with slash commands.

**What's new**

- Chat is the home screen: greeting, large message box, conversation history in the sidebar grouped by day, search, rename and delete.
- Slash commands in the message box: type `/` to see them (for example `/task`, `/note`, `/tasks`). They run locally and are never sent to the model.
- `⌘⇧O` / `Ctrl+Shift+O` starts a new chat. `⌘K` / `Ctrl+K` opens the command bar.
- The old dashboard moved to **Today**.
- New message layout, code blocks, hover actions and loading states; refreshed light and dark themes; better phone layout.
- The version is shown at the bottom of the sidebar.

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

## Connect your phone (easiest way)

If you use the Mac or Windows app, it can serve your phone directly:

1. On the computer, open OMNI AI and choose **Phone → Connect your phone…** from the menu bar, then **Turn on phone access**. A window shows an address (like `http://192.168.1.20:47832`) and a 6-digit code.
2. On the phone (same Wi-Fi), open the OMNI AI Android app and type the address.
3. Enter the 6-digit code when asked. Once per phone.
4. Done. Keep the computer on and the app open while you use the phone. Turn phone access off when you are done; it also turns off whenever OMNI closes.

Anyone on the same Wi-Fi who has the code can use your OMNI while it is on, so do not leave it on in shared places. The code changes every time you turn it on.

## Android

The phone app does not contain the server. The easiest way is the Mac or Windows app's built-in phone access (above); the steps below are for running your own server.

1. Run OMNI on a computer or server (`npm run build && npm start`, or Docker; see the README) with a PostgreSQL database. Hosted ones such as Supabase work; use the direct or session connection, not the transaction pooler.
2. On your phone, open the `.apk`. Allow **Install unknown apps** for your browser or file manager when asked.
3. Open OMNI AI and enter your server's address, for example `https://omni.example.com`. Use https if the server is reachable from the internet, and set `OMNI_REQUIRE_LOGIN=1` on it so only you can get in.
4. The app is signed with a test key, so it can't update over an app installed from elsewhere. Uninstall first if installation fails.
5. Exports (PDF, Word and so on) don't download inside the app yet; open the server in a browser to export.

## Your data

The Mac and Windows apps keep everything on your computer in the data folder above. It holds the database and the key that encrypts your saved API keys. **Back it up** if your data matters; losing the key means re-entering saved keys.

## Not tested everywhere

Built automatically and not signed with a paid certificate. The Mac app was run on the developer's Mac. The Windows and Android apps were built by GitHub Actions but not run on real devices before release. The AI was tested with a stand-in model, not live OpenRouter. Please report problems as issues.
