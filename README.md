<div align="center">

<img src="extension/icons/logo.svg" alt="FlowDoc logo" width="96" height="96">

# FlowDoc

**Do a task on your PC once. FlowDoc writes the how-to guide for you, with screenshots.**

[![Latest release](https://img.shields.io/github/v/release/avin045/FlowDoc)](https://github.com/avin045/FlowDoc/releases/latest)
[![License](https://img.shields.io/github/license/avin045/FlowDoc)](LICENSE)
[![Platforms: Windows, Linux, Chrome and Edge](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20Chrome%20%7C%20Edge-0078D6)](#other-ways-to-run-flowdoc)

[![Download for Windows](https://img.shields.io/badge/Download%20for%20Windows-4F46E5?style=for-the-badge)](https://github.com/avin045/FlowDoc/releases/latest)

[![Chrome / Edge extension: any computer](https://img.shields.io/badge/Chrome%20%2F%20Edge%20extension-any%20computer-4285F4?logo=googlechrome&logoColor=white)](docs/user-guide.md#install-the-browser-extension)
[![Linux: build from source](https://img.shields.io/badge/Linux-build%20from%20source-FCC624?logo=linux&logoColor=black)](docs/user-guide.md#run-flowdoc-on-linux)

[Download](#download) · [User guide](docs/user-guide.md) · [Privacy](PRIVACY.md) · [Developers](docs/developers.md)

</div>

## Download

On the release page, under **Assets**, click `FlowDoc.Setup.<version>.exe`, not "Source code".

Windows 10 (version 2004 or newer) or 11 · 64-bit · free and open source (Apache-2.0)

**Not on Windows?** On Linux, you can [build the desktop app from source](docs/user-guide.md#run-flowdoc-on-linux). On Linux or Mac, the [Chrome / Edge extension](docs/user-guide.md#install-the-browser-extension) records anything you do in the browser. See [Other ways to run FlowDoc](#other-ways-to-run-flowdoc).

Your browser or Windows may warn you before it runs, because FlowDoc is free and doesn't pay for a code-signing certificate. The source code is public. [What to click](docs/user-guide.md#if-your-browser-or-windows-warns-you).

![FlowDoc's home screen, ready to capture a first guide](docs/screenshots/home-light.png)

> [!NOTE]
> No FlowDoc account, no FlowDoc server, no analytics. Your guides stay on your PC. Data leaves only if you turn on the optional AI (your own Gemini or Groq key) or Save to Notion. [Privacy policy](PRIVACY.md).
>
> FlowDoc records only after you press **New capture**, a recorder bar stays visible while it does, and passwords are never saved.

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

## Other ways to run FlowDoc

- **Chrome or Edge extension:** records inside browser tabs, on Windows, Mac or Linux. No install tools needed: [install the browser extension](docs/user-guide.md#install-the-browser-extension).
- **Linux:** build the desktop app from source. It hasn't been tested on real hardware yet. See [Run FlowDoc on Linux](docs/user-guide.md#run-flowdoc-on-linux).
- **Try the editor in a browser:** the [web workspace](docs/developers.md#web-workspace) runs the editor and a sample guide locally, without recording.

## Documentation

The full manual moved to the **[user guide](docs/user-guide.md)**: recording, editing, exporting, AI, Notion, troubleshooting and limitations.

- [Developers guide](docs/developers.md): build from source, run the tests, how the recorder works
- [Release notes](https://github.com/avin045/FlowDoc/releases)

## License

FlowDoc is free and open source under the [Apache License 2.0](LICENSE). Copyright 2026 avin045.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

FlowDoc is an alternative to tools like Scribe. It is not affiliated with Scribe.
