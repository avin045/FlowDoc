# Install FlowDoc

FlowDoc comes as a desktop app and as a browser extension. Pick the one for your computer:

- **[Windows](#windows)**: download the installer. Recommended: it records any app on your PC.
- **[Linux](#linux)**: build the desktop app from source.
- **[Chrome and Edge extension](#chrome-and-edge-extension)**: works on any computer, and records what you do inside the browser.

Not sure which one? See [Which version should I use?](#which-version-should-i-use) below. Once FlowDoc is installed, the [user guide](user-guide.md) explains how to record, edit and export guides.

## Which version should I use?

| | Desktop app (recommended) | Chrome / Edge extension |
| --- | --- | --- |
| Records | Clicks and typing in **any app**: File Explorer / Files, browsers, Office, Settings, terminals… | Clicks and typing inside **browser tabs** |
| Platforms | Windows 10/11, Linux (X11 session) | Chrome, Edge (Windows, Linux, macOS) |
| Install | Download the installer from the Releases page (Windows); build from source (Linux) | Download the code as a ZIP and load the `extension` folder into the browser |
| Tested | Yes, on Windows (Linux not yet on real hardware) | Yes, by hand in Google Chrome; automated test in Microsoft Edge |
| What to record | Whole screen, an area, or only the apps you choose | The browser tab you pick |
| Improve with AI (Gemini / Groq) | Optional: Crisp, Elaborate or Conceptual. Key encrypted by your operating system (DPAPI on Windows, GNOME Keyring or KWallet on Linux). | Optional: same styles. Key kept in browser storage, encrypted (AES-GCM). |
| Translate a guide | Optional (needs AI) | Optional (needs AI) |
| Continue capturing | Yes | Yes |
| Save to Notion | Optional | Optional |
| Your own guides folder | Yes | — (stored in the browser) |
| Click highlight style (Normal / Box only / None) | Yes, in Settings | — (only the per-guide **Highlights** toggle) |
| Light / Dark / System theme | Yes | Yes |
| Editor and exports | Same | Same |

Start with the **desktop app**. It records everything, including work in other programs, such as saving a file in File Explorer, changing a Windows setting or using Excel. The **extension** suits processes that happen entirely in a web browser.

**What you need:**

- **Desktop app on Windows:** Windows 10 (version 2004 or newer) or Windows 11, 64-bit. Version 2004 or newer is needed to keep the recorder bar out of screenshots.
- **Desktop app on Linux:** a desktop session running **X11 (Xorg)**, not Wayland, plus a few system packages. See [Linux one-time setup](developers.md#linux-one-time-setup).
- **macOS:** the desktop app isn't available yet. The extension works in Chrome and Edge on macOS.
- **Extension:** [Google Chrome](https://www.google.com/chrome/) or [Microsoft Edge](https://www.microsoft.com/edge), a recent version.

## Windows

The desktop app records clicks and typing in any app on your PC.

### Download and run the installer

1. Go to the [latest release](https://github.com/avin045/FlowDoc/releases/latest). Under **Assets**, click `FlowDoc.Setup.<version>.exe`. Don't pick "Source code"; that's for developers.
2. Open the downloaded file. If your browser or Windows shows a warning, see the next section.
3. On **Choose Installation Options**, keep **Only for me**. This needs no administrator rights.
4. On **Choose Install Location**, keep the suggested folder or pick another one, and click **Install**.
5. On the last page, leave **Run FlowDoc** ticked and click **Finish**.

The FlowDoc window opens, and a FlowDoc icon appears in the system tray (bottom-right, near the clock).

### If your browser or Windows warns you

FlowDoc is free and isn't signed with a paid code-signing certificate, so Windows and your browser don't recognise it yet. The source code is public in this repository. Depending on your browser and settings, you may see one or more of these warnings:

1. **Microsoft Edge:** the download list says the file "isn't commonly downloaded". Point at the file, click **⋯** → **Keep**, then **Show more** → **Keep anyway**.
2. **Google Chrome:** the download list may mark the file as unverified or suspicious. Open the menu next to the file and choose the option to keep or download it anyway.
3. **Windows SmartScreen** ("Windows protected your PC"): click **More info**, then **Run anyway**.
4. **Smart App Control** (Windows 11 only): if Windows says Smart App Control blocked the app, there is no **Run anyway** button. Don't turn Smart App Control off just for FlowDoc: on Windows 11, once it's off you can't turn it back on without resetting or reinstalling Windows. Use the [browser extension](#chrome-and-edge-extension) instead.

### After you install

- Open FlowDoc from the Start menu. Click **New capture** (or press **Alt+Shift+R** anywhere) to record your first guide; see [Record with the desktop app](user-guide.md#record-with-the-desktop-app). Or click **Open a sample guide** to look around first.
- FlowDoc doesn't update itself. To update, download and run the newer installer from the [latest release](https://github.com/avin045/FlowDoc/releases/latest). Your guides are kept.
- If you have a GitHub account, click **Watch** → **Custom** → **Releases** on the repository page to get an email when a new version comes out.

### Uninstall the desktop app

1. Open Windows **Settings → Apps**, find **FlowDoc**, and click **Uninstall**.
2. Your guides are kept until you delete the data folder listed in [Where your guides are stored](user-guide.md#where-your-guides-are-stored).

## Linux

There's no Linux download yet, so you build the desktop app from source. The Linux build hasn't been tested on real hardware yet. If you'd rather not build anything, the [Chrome and Edge extension](#chrome-and-edge-extension) works on Linux too.

### Build and install on Linux

1. Prepare your system and build the app by following [Build the installers](developers.md#build-the-installers) in the developers guide.
2. Do the [Linux one-time setup](developers.md#linux-one-time-setup): FlowDoc needs an X11 (Xorg) session, not Wayland, and a few helper packages.
3. Install one of the two files the build creates:
   - `FlowDoc-<version>.AppImage`: make it executable with `chmod +x FlowDoc-*.AppImage`, then double-click it or run it from a terminal.
   - `flowdoc_<version>_amd64.deb` (Debian/Ubuntu): install it with `sudo apt install ./flowdoc_*_amd64.deb`. This also installs the required system packages.

### Where guides are stored on Linux

`~/.config/FlowDoc/` for the installed app, or `~/.config/flowdoc/` when running from source. The folder layout is the same as on Windows (see [Where your guides are stored](user-guide.md#where-your-guides-are-stored)).

### Uninstall on Linux

Run `sudo apt remove flowdoc`, or delete the AppImage. Your guides are kept until you delete the data folder above.

## Chrome and Edge extension

The extension works in Chrome and Edge on Windows, Mac and Linux, and records what you do inside the browser.

### Install the extension

You don't need any developer tools for this.

1. On the [repository page](https://github.com/avin045/FlowDoc), click **Code** → **Download ZIP**.
2. Unzip it to a folder you will keep, for example `Documents\FlowDoc`, not your Downloads folder. The browser loads the extension from this folder every time it starts.
3. Open your browser's extensions page:
   - **Chrome:** type `chrome://extensions` in the address bar and press Enter.
   - **Edge:** type `edge://extensions` in the address bar and press Enter.
4. Turn on **Developer mode**: a switch at the top-right in Chrome, or in the left sidebar in Edge.
5. Click **Load unpacked** and select the `extension` folder inside the folder you unzipped (the folder that contains `manifest.json`).
6. **FlowDoc - Step Recorder** now appears in the list. Click the puzzle-piece icon in the toolbar, then the pin icon next to FlowDoc, so its icon is always visible.

> Pages that were already open before you installed the extension can't be recorded until you reload them (F5). FlowDoc reloads its recorder into the current tab automatically when you start a capture, so this mostly matters for other tabs.

The extension records only inside the browser. For work in other programs (File Explorer, Office, Settings…), use the [desktop app](#windows).

### Update the extension

1. Export a backup of your guides first: open each guide you want to keep and use **Export → Backup (.json)**.
2. Download the new ZIP and unzip it **over the same folder** you loaded before, replacing the old files.
3. Open `chrome://extensions` (or `edge://extensions`) and click the **reload** (circular arrow) icon on the FlowDoc card.
4. Reload any tabs you want to record.

Don't remove the old FlowDoc card, and don't load a different folder. The browser treats a different folder as a new, empty extension, and removing the old card deletes the guides stored in it.

### Change the keyboard shortcut

Open `chrome://extensions/shortcuts` (or `edge://extensions/shortcuts`). Find **FlowDoc → Start or stop capturing** and set the key combination you want.

### Uninstall the extension

Open `chrome://extensions` and click **Remove** on the FlowDoc card. This also deletes the guides stored in the extension, so export backups first if you want to keep them.
