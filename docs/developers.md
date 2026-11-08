# FlowDoc for developers

How to run FlowDoc from source, build the installers, run the tests, and find your way around the code. If you only want to use FlowDoc, start with the [installation guide](installation.md) and the [user guide](user-guide.md).

## What you need

> **Install Node.js and Git first.** Everything else (Electron, the recorder, the export libraries) is downloaded by `npm install` when you [get the code](#get-the-code).

| What | Version | Where to get it | How to check it's installed |
| --- | --- | --- | --- |
| **Node.js** (includes **npm**) | 18 or newer. The **LTS** version is recommended. | [nodejs.org/en/download](https://nodejs.org/en/download) | `node -v` shows v18 or higher, and `npm -v` shows a version number |
| **Git** | Any recent version | [git-scm.com/downloads](https://git-scm.com/downloads) | `git --version` shows a version number |

**Installing on Windows:**

- **Node.js:** run the `.msi` installer and keep the defaults. Make sure **npm package manager** and **Add to PATH** stay selected. You do **not** need the optional "Tools for Native Modules" (Visual Studio Build Tools); FlowDoc's recorder ships ready-built.
- **Git:** run the Git for Windows installer and keep the defaults.
- **Afterwards:** close and reopen your terminal (Command Prompt, PowerShell or Windows Terminal) so it picks up the new programs, then run the check commands above.

**Installing on Linux:**

- **Node.js:** use the official installer, or your distribution's package. Ubuntu 22.04's default is too old, so prefer the NodeSource or nvm instructions linked from the Node.js download page.
- **Git:** usually `sudo apt install git` (Debian/Ubuntu) or `sudo dnf install git` (Fedora).

**You'll also need:**

- an internet connection for `npm install`, which downloads about 500 MB the first time;
- about **1 GB of free disk space**: roughly 500 MB for the project's dependencies, plus room for screenshots and, if you build installers, about 400 MB more.

**Operating system:** the desktop app runs on Windows 10 (version 2004 or newer) or Windows 11, and on Linux in an X11 (Xorg) session (see [Linux one-time setup](#linux-one-time-setup)). macOS isn't supported yet. The extension needs a recent Chrome or Edge.

## Get the code

Make sure Node.js and Git are installed (see [What you need](#what-you-need)), then run these commands in a terminal:

```bash
git clone https://github.com/avin045/FlowDoc.git
```

```bash
cd FlowDoc
```

```bash
npm install
```

`npm install` downloads the desktop runtime (Electron), the global input hook and the test tools. It also refreshes the PDF, Word and zip libraries in `extension/vendor/` (browser extensions aren't allowed to load code from the internet, so those libraries are kept in the repository).

## Run the desktop app from source

In the `FlowDoc` folder:

```bash
npm run desktop
```

The FlowDoc window opens, and a FlowDoc icon appears in the system tray (Windows: bottom-right, near the clock; Linux: top bar).

A copy running from source keeps its data in `%APPDATA%\flowdoc\` (Windows) or `~/.config/flowdoc/` (Linux), separate from an installed copy, which uses `FlowDoc` with a capital F.

## Build the installers

**Windows:**

```bash
npm run dist:win
```

The first build downloads the packaging tools (about 150 MB) and takes a few minutes. Later builds are faster. The build runs in a temporary folder, and the finished files are copied into `FlowDoc/dist/`:

- `FlowDoc Setup <version>.exe`: an installer that adds Start-menu and desktop shortcuts. Double-click it and follow the wizard.
- `FlowDoc <version>.exe`: a portable version that runs without installing.

The app isn't code-signed, so Windows may warn before it runs. See [If your browser or Windows warns you](installation.md#if-your-browser-or-windows-warns-you).

**Linux** (build on a Linux machine):

```bash
npm run dist:linux
```

This creates two files in `dist/`:

- `FlowDoc-<version>.AppImage`: make it executable with `chmod +x FlowDoc-*.AppImage`, then double-click it or run it from a terminal.
- `flowdoc_<version>_amd64.deb` (Debian/Ubuntu): install it with `sudo apt install ./flowdoc_*_amd64.deb`. This also installs the required system packages.

If a build fails, see [Build errors](#build-errors).

**Hardened builds.** The installers turn off Electron features FlowDoc doesn't use (Electron "fuses"): the app can't be started as a plain Node.js runtime, ignores `NODE_OPTIONS` and `--inspect`, loads its code only from `app.asar`, and refuses to start if `app.asar` was changed after the build. To check a build: `npx electron-fuses read --app <path to FlowDoc.exe>`.

## Linux one-time setup

Do this before your first capture on Linux:

1. **Use an X11 (Xorg) session.** Wayland, the default on recent Ubuntu and Fedora, doesn't let apps see clicks in other windows.
   - Log out. On the login screen, click your name, then the **gear icon** at the bottom-right, and choose **"Ubuntu on Xorg"** (or "GNOME on Xorg" or "Plasma (X11)").
   - FlowDoc shows a yellow warning on its home screen when it detects Wayland.
2. **Install the helper packages.** The `.deb` package does this automatically. If you run from source or use the AppImage, install them yourself.
   - **Debian / Ubuntu:**

     ```bash
     sudo apt install libxtst6 libxkbfile1 python3-gi gir1.2-atspi-2.0 xdotool
     ```

   - **Fedora:** `sudo dnf install libXtst libxkbfile python3-gobject at-spi2-core xdotool`

   `python3-gi` and `gir1.2-atspi-2.0` let FlowDoc read button and field names. Without them, steps fall back to the window title, for example "Click in **Files**".

## Load the extension from source

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select the `FlowDoc/extension` folder in your clone (the folder that contains `manifest.json`).

To update after pulling new code:

1. Run `git pull` and then `npm install` in the `FlowDoc` folder.
2. Open `chrome://extensions` and click the **reload** (circular arrow) icon on the FlowDoc card.
3. Reload any tabs you want to record.

Keep loading the same folder. The extension has no fixed ID (`extension/manifest.json` has no `"key"`), so the browser identifies it by its folder; a different folder loads as a separate extension with empty storage.

## Web workspace

```bash
npm run serve
```

Open http://localhost:5173 to use the editor in any browser. Guides are stored in that browser's IndexedDB. Use it to view, edit and export backups, or to try the sample guide. Recording still needs the extension or the desktop app. A practice website for test captures runs at http://localhost:5173/demo/.

## Tests

```bash
npm test
```

```bash
npm run test:desktop
```

- **`npm test`** loads the extension in Chromium and records a sign-in and ticket flow on the demo site. It then edits the guide (title, tip, redaction, reorder, undo/redo), exports all five formats and validates every file. It also saves the guide to a mock Notion, and checks that keys and secrets are stored encrypted (and that older plain keys get encrypted).
  - Chrome 137 and later ignore `--load-extension`. To use an installed Edge instead, run `$env:BROWSER='msedge'; npm test` (PowerShell) or `BROWSER=msedge npm test` (bash).
- **`npm run test:desktop`** launches the desktop app and opens the demo site in a window. It feeds the recorder hook events at real element positions, so screen capture and the accessibility inspector run for real without moving your mouse. It also:
  - checks step text, password masking (also after **Show password**, and covered in every screenshot), double-click (one step, one screenshot), right-click and shortcuts;
  - checks that screenshots are stored as image files, and the workspace's lockdown: its security policy, import cleaning, blocked navigation and refused permissions;
  - runs **Improve with AI** in all three styles against mock Gemini and Groq servers, including a background run that finishes after you've left the guide, and checks keys, models, JSON mode, model fallback and the no-invented-values guard;
  - checks the model dropdown, the theme switch, the custom guides folder, and data carried over from an older data folder;
  - saves the guide to a mock Notion server, checking the version header, multipart uploads, the parent page and block chunking;
  - runs every export inside the desktop app.

  A demo window briefly appears on screen while it runs. To test a packaged build, set `FLOWDOC_APP_EXE` to the path of `FlowDoc.exe`.

  The test's own settings (`FLOWDOC_SELFTEST`, the mock server URLs and the like) only take effect together with a separate data folder (`FLOWDOC_USER_DATA`), and mock URLs only on `localhost`. A normal launch ignores them, so they can't redirect your API keys or run the test on your real guides.

Results and screenshots from both tests go to `test-output/`.

## How the desktop recorder works

- **Global input hook:** `uiohook-napi` sees mouse and keyboard events system-wide, and runs only while a capture is active. It ships prebuilt binaries, so no compiler is needed (`npmRebuild: false`).
- **Screen capture:** a hidden window keeps a low-frame-rate stream of every display open while recording. When a mouse button goes down, the current frame is grabbed, so the screenshot shows the screen *before* the click changed it.
- **Element names:**
  - **Windows:** UI Automation, through a long-running PowerShell helper (`desktop/inspector/windows.ps1`).
  - **Linux:** AT-SPI, through `desktop/inspector/linux.py`, with `xdotool` as a fallback.
- **AI calls** run in the main process (`desktop/ai.js`), so API keys never reach the web page.

## How passwords are kept out of guides

- **Which fields count:** a field the system or browser reports as a password field; one that was a password field earlier in the capture (so it still counts after **Show password** turns it into plain text); one labelled as a password or PIN (English, Tamil, Hindi and many other languages); in the extension, also `autocomplete="current-password"` / `"new-password"`.
- **Step text:** typing in such a field always becomes "Type your password in the **…** field". The value is never stored; keystrokes stay in memory only.
- **Screenshots:** every password field on screen is covered *in the image itself*, before the step is saved, so the original pixels never reach the guide, backups, exports, AI or Notion.
  - **Desktop:** the recorder remembers each field's position per window (following the window if it moves) and the hidden capture window paints over it (`desktop/recorder.js`, `desktop/capture-renderer.js`).
  - **Extension:** the page script finds the password fields on screen, including inside web components and same-site frames, and sends their boxes with each step; the background worker paints over them (`extension/content.js`, `extension/background.js`).
- **Safeguards:**
  - The cover is one solid colour taken from just outside the field, with a thin outline: nothing inside is used, so neither characters, dots nor the password's length survive.
  - If covering fails, the step is kept **without** a screenshot rather than with one showing a password.
  - Boxes sent by a web page are validated and capped at 20, so a page can only make FlowDoc cover more, never less.
  - Desktop: when the element under the pointer can't be identified, every known password field on that display is covered.
- **Limits:** the extension can't look inside a frame from another website, so a password field there isn't covered. The desktop app knows a password field only once you've clicked or typed in it, so a field the browser filled in by itself may still show its dots (never the password).
- **Tests:** both suites record a **Show password** scenario and check the masked text, a covered field in every shot, and one flat colour where the revealed password was.

## Project layout

```
desktop/
  main.js              Electron main: windows, tray, shortcut, IPC, app:// protocol
  recorder.js          global hook -> steps (clicks, typing, keys, shortcuts)
  capture.js           live screen streams, instant frame grabs (capture.html/-renderer.js)
  inspector/           UI Automation (windows.ps1) / AT-SPI (linux.py) helpers
  ai.js                Gemini + Groq clients, model fallback (main process only)
  notion.js            Notion client (from extension/shared/notionClient.js)
  settings.js          settings + API keys encrypted by the OS
  store.js             JSON file store under the user-data folder
  widget.html/js       floating recorder bar
  selftest.js          desktop self-test (npm run test:desktop)
extension/
  manifest.json        MV3 manifest
  background.js        recording session, screenshots (captureVisibleTab), step storage
  content.js           event capture + element labelling + recorder bar (shadow DOM)
  popup.html/js/css    toolbar popup
  app.html             workspace (library + editor), shared with the desktop app
  app/main.js          routing, library, editor, export dialog
  app/render.js        step text markup, screenshot compositing (highlight/redact/crop)
  app/imageEditor.js   screenshot editor
  app/exporters/       pdf.js, docx.js, html.js, markdown.js
  app/ai.js            writing styles (Crisp/Elaborate/Conceptual), prompts, guard rails
  app/aiJobs.js        background AI jobs with progress and time estimates
  app/desktop.js       settings and "Improve with AI" dialogs
  app/aiHost.js        settings, keys and requests: desktop main process, or the extension's storage
  app/notion.js        Save to Notion dialog and page picker
  app/theme.js         System / Light / Dark theme, applied before first paint
  shared/guides.js     storage (chrome.storage, desktop file store or IndexedDB)
  shared/aiClient.js   Gemini + Groq clients, model fallback (desktop and extension)
  shared/notionClient.js  Notion client: search pages, upload screenshots, create the page
  shared/secretStore.js   AES-GCM encryption of the extension's keys and secrets
demo/                  practice site
docs/                  user guide, this page, screenshots, release notes, designs
scripts/               vendor copy, icon render, static server, tests
```

## Build errors

| Problem | Fix |
| --- | --- |
| `npm run dist:win` fails with **EBUSY / resource busy** | Handled automatically. The build runs in a temporary folder and only the finished installers are copied into `dist/`, because programs that watch the project folder (editors, antivirus, the Claude desktop app) can briefly lock files mid-build. If it still fails, close those programs and retry. |
| `npm run dist:win` fails with **copyfile … elevate.exe: UNKNOWN** | Handled automatically. This happens when your `AppData` folder has the Windows "Encrypted" (EFS) attribute: electron-builder's cached tools inherit it, and Windows Home can't copy encrypted files. The build script keeps that cache in the temp folder instead. |
