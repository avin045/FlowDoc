<div align="center">

<img src="extension/icons/logo.svg" alt="FlowDoc logo" width="96" height="96">

# FlowDoc

**Do a task on your PC once. FlowDoc writes the how-to guide for you, with screenshots.**

[![Latest release](https://img.shields.io/github/v/release/avin045/FlowDoc)](https://github.com/avin045/FlowDoc/releases/latest)
[![License](https://img.shields.io/github/license/avin045/FlowDoc)](LICENSE)
[![Platforms: Windows, Linux, Chrome and Edge](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20Chrome%20%7C%20Edge-0078D6)](#install)

[![Download for Windows](https://img.shields.io/badge/Download%20for%20Windows-4F46E5?style=for-the-badge)](https://github.com/avin045/FlowDoc/releases/latest)
[![Add to Chrome: free in the Chrome Web Store](https://img.shields.io/badge/Add%20to%20Chrome-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/gfpdkldffmgjljmmfhcdaladmoeomffl)

[![Chrome Web Store version](https://img.shields.io/chrome-web-store/v/gfpdkldffmgjljmmfhcdaladmoeomffl?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/gfpdkldffmgjljmmfhcdaladmoeomffl)
[![Linux: build from source](https://img.shields.io/badge/Linux-build%20from%20source-FCC624?logo=linux&logoColor=black)](docs/installation.md#linux)

[Install](#install) · [Watch the demo](#see-it-in-action) · [User guide](docs/user-guide.md) · [Privacy](PRIVACY.md) · [Developers](docs/developers.md)

</div>

## See it in action

https://github.com/user-attachments/assets/02d26305-98c9-4200-8325-d310765a0757

## Install

Pick your computer. Each one has full steps in the [installation guide](docs/installation.md).

<details open>
<summary><b>Windows</b>: download the installer (recommended)</summary>

<br>

1. Click **Download for Windows** above, or open the [latest release](https://github.com/avin045/FlowDoc/releases/latest).
2. Under **Assets**, click `FlowDoc.Setup.<version>.exe`, not "Source code".
3. Open the file and follow the installer. Keep **Only for me**: no administrator rights needed.

Needs Windows 10 (version 2004 or newer) or 11, 64-bit. Your browser or Windows may warn you before it runs, because FlowDoc is free and doesn't pay for a code-signing certificate. The source code is public. [What to click](docs/installation.md#if-your-browser-or-windows-warns-you) · [Full Windows steps](docs/installation.md#windows)

</details>

<details>
<summary><b>Linux</b>: build from source</summary>

<br>

There's no Linux download yet. Build the desktop app from source and install it by following [Install on Linux](docs/installation.md#linux). The Linux build hasn't been tested on real hardware yet.

Rather not build anything? The Chrome / Edge extension below works on Linux too.

</details>

<details>
<summary><b>Chrome or Edge extension</b>: install from the Chrome Web Store, on any computer (Windows, Mac, Linux)</summary>

<br>

1. Click **Add to Chrome** above, or open [FlowDoc - Step Recorder in the Chrome Web Store](https://chromewebstore.google.com/detail/gfpdkldffmgjljmmfhcdaladmoeomffl).
2. Click **Add to Chrome**, then **Add extension**.
3. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to FlowDoc.

**Edge:** open the same Web Store page, click **Allow extensions from other stores** when Edge asks, then add it the same way.

The extension records what you do inside the browser only, and updates itself automatically. [Full extension steps](docs/installation.md#chrome-and-edge-extension), including a manual install from the source code.

</details>

![FlowDoc's home screen, ready to capture a first guide](docs/screenshots/home-light.png)

> [!NOTE]
> No FlowDoc account, no FlowDoc server, no analytics. Your guides stay on your PC. Data leaves only if you turn on the optional AI (your own Gemini or Groq key) or Save to Notion. [Privacy policy](PRIVACY.md).
>
> FlowDoc records only after you press **New capture**, a recorder bar (or, in the extension, the toolbar icon's badge) shows while it does, and passwords are never saved.

## How it works

| ![The Start a capture dialog](docs/screenshots/how-capture.png) | ![A recorded guide in the editor](docs/screenshots/how-edit.png) | ![The Export guide dialog](docs/screenshots/how-export.png) |
| :---: | :---: | :---: |
| **1. Start a capture**, then do the task in any app | **2. Edit the steps**: FlowDoc wrote them and took the screenshots | **3. Export** to PDF, Word, HTML or Markdown |

## Features

| Works right away | Optional, needs setup |
| --- | --- |
| Records clicks and typing in any Windows app: File Explorer, Excel, Settings, your browser… | **Improve with AI**: rewrites the steps from the screenshots, using your own free Gemini or Groq key |
| Records the whole screen, one area, or only the apps you choose | **Translate** a guide into Tamil, Hindi, Spanish and many other languages (needs AI) |
| Edit steps, add tips and headings, reorder with drag and drop | **Save to Notion**: connect your own Notion and save guides as pages |
| Blur private details and crop screenshots | |
| Export to PDF, Word, HTML, Markdown or a backup file | |
| Passwords kept out of steps and screenshots | |
| Light and dark theme | |

## Documentation

The full manual moved to the **[user guide](docs/user-guide.md)**: recording, editing, exporting, AI, Notion, troubleshooting and limitations.

- [Installation guide](docs/installation.md): Windows, Linux, and the Chrome / Edge extension
- [Developers guide](docs/developers.md): build from source, run the tests, how the recorder works
- [Web workspace](docs/developers.md#web-workspace): try the editor and a sample guide in a browser, without recording
- [Release notes](https://github.com/avin045/FlowDoc/releases)

## License

FlowDoc is free and open source under the [Apache License 2.0](LICENSE). Copyright 2026 avin045.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

FlowDoc is an alternative to tools like Scribe. It is not affiliated with Scribe.
