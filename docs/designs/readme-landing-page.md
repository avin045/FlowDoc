# FlowDoc README landing page and docs restructure

*   **Author:** avin045
*   **Status:** Proposed
*   **Date:** 2026-11-08

--------------------------------------------------------------------------------

## Overview

FlowDoc's README is the first page every visitor sees on GitHub, and right now it is the full user manual (about 820 lines). This design replaces it with a short landing page for non-technical Windows users, built around one action: download and install the Windows app. The full manual moves into two files under `docs/`. Every section is kept, reworded in plain English, and corrected where the brainstorm review found errors. The change is limited to documentation files and GitHub repository settings. No application code or build configuration changes.

## The Problem

A visitor who opens the repo today sees:

1. A "Contents" list, seven screenshots, and then a "Before you start" section that asks for Node.js 18+ and Git.
2. Instructions to clone the repository and run `npm install`.
3. Two ways to install the desktop app: run it from source, or build an installer yourself.

The README never links to the Releases page, where a ready-made Windows installer is waiting. It only mentions the installer as something you build yourself (line 160). A non-technical user who just wants the app has to read through developer setup to find out it exists, and most will leave before they do. The release has 3 downloads.

The README also contains claims that are wrong or out of date. These would carry over into any rewrite if they weren't fixed:

*   **"Desktop only" Notion:** it says the desktop app "can also" save to Notion. The extension can too.
*   **`npm install` for the extension:** it says the extension needs `npm install`. It doesn't: `extension/vendor/` is committed to git.
*   **Missing install warnings:** the SmartScreen steps appear in four places. None of them mentions the browser's own download warning or Smart App Control, which an unsigned, rarely downloaded installer can also trigger.
*   **Desktop app not covered by the privacy policy:** `PRIVACY.md` covers only the browser extension, but the main download is the desktop app.
*   **Old-style naming:** it describes FlowDoc as "in the style of Scribe (scribehow.com)". That makes it look like a copy instead of saying what it does differently: it works without an account, keeps guides on your PC, and records any Windows app.

Proposed solution: a landing-page README whose first block is the download, and a two-file manual in `docs/` that keeps every section and has the errors fixed.

## Goals

*   **Download is the first thing in the README.** Nothing inside the README can sit above the fold. Measured on 2026-11-08 (signed out, 1366×768): GitHub starts the README box at 949 px, below the 768 px window, because of the repo header and the 13-row file list, which this change makes 2 rows longer. The pass criterion is that the "Download for Windows" badge sits within the first 450 px of the README box, so the first scroll that reaches the README also shows the button. GitHub's About box, beside the file list, shows the repo's homepage link. That link is set to `releases/latest` (see Repository settings), so it may be a download path visible without scrolling. That isn't measured yet; the after-merge check confirms it. Checked on the rendered branch at 1366×768.
*   **No developer setup on the landing page.** `README.md` doesn't mention Node.js, Git, `npm`, `git clone`, Electron, DPAPI, AppImage, X11 or MV3. Check with a search of the file.
*   **Install help that covers every warning.** The steps cover all three warnings an unsigned installer can trigger:
    *   the browser's download warning
    *   SmartScreen
    *   Smart App Control

    They are written in one place (`docs/user-guide.md`), and the README links to them with two or three lines of its own.
*   **No content lost.** Every H2/H3 heading in today's README has a row in the mapping table (Detailed Implementation) that names its new file and heading, or gives the reason it was removed. The only content allowed to be removed is the rows marked **Removed** in that table, plus the corrections named in its Notes column.
*   **No broken links.** Every relative link and `#anchor` in `README.md`, `docs/user-guide.md`, `docs/developers.md`, `CONTRIBUTING.md` and the other new files resolves on the rendered branch. Check with one link-checker run plus a manual click-through of the anchors that cross files.
*   **Accurate claims.** The privacy note, feature list and platform support match the code:
    *   Data leaves the PC only through the optional AI or Notion features.
    *   There are five export formats.
    *   Notion works in both the desktop app and the extension.
    *   The desktop app is Windows only as a download; Linux is build-from-source and untested on real hardware.
*   **Current screenshots.** Every image the docs link to exists in `docs/screenshots/` and shows the current (v1.1.1) interface. Done on 2026-11-08.
*   **No version numbers to update each release.** README and docs prose contain no version numbers or installer file names with versions. The version appears only through the dynamic release badge.
*   **Discoverable repo.** The GitHub description matches the README tagline. Topics are set (without `self-hosted`). The homepage URL points to `releases/latest`, and the empty wiki is turned off.
*   **The old product name stays out.** No new or changed file contains it.

## Non-Goals

*   No change to application code, `package.json`, build settings or installer file names. (A version-free `artifactName` per build target is a separate follow-up.)
*   No animated GIF and no designed banner image. The hero is `docs/screenshots/home-light.png` as it is.
*   No GitHub Pages site.
*   No new release files (portable `.exe`, AppImage, `.deb`), no code signing, and no Chrome Web Store listing.
*   No CI, linting, or issue/PR templates.
*   No fix for `scripts/dist.mjs` pointing to a missing "Build installers in the cloud" section. It is recorded as a known broken reference.
*   No translation of the docs into other languages.

## Open Questions

None at this stage. The five questions open at the start of drafting were decided by the author on 2026-11-08:

*   **Plain headings, no numbering.** Each section in the moved manual gets a short plain-English heading. The 25 body links that jump to a heading are rewritten and checked; the 11 links in Contents are removed with it.
*   **SECURITY.md only**, with GitHub private vulnerability reporting turned on. No CODE_OF_CONDUCT.md.
*   **`PRIVACY.md` is widened** to cover both the desktop app and the extension.
*   **The Download button is a shields.io `for-the-badge` badge.**
*   **The old release notes are edited**, both `docs/release-notes/*.md` and the two published GitHub release descriptions, so "See the README" points to the user guide.

## Critical User Journeys (CUJs)

### CUJ 1: A non-technical Windows user installs FlowDoc

*   **Given**: A visitor on Windows 10 (2004+) or 11, 64-bit, using Edge or Chrome, opens `github.com/avin045/FlowDoc` with no prior knowledge of the project.
*   **When**: They read the top of the page and click **Download for Windows**.
*   **Then**:
    *   They land on the latest release and know which file to click: the line under the button names `FlowDoc.Setup.<version>.exe` and warns them not to pick "Source code".
    *   If the browser warns about the download, or Windows shows "Windows protected your PC", the README has already told them what to click and why it appears.
    *   They finish the installer with its defaults and know how to start their first capture.

### CUJ 2: A visitor checks whether FlowDoc is safe and private

*   **Given**: A cautious visitor, possibly with an antivirus that flags keyboard hooks.
*   **When**: They read the privacy note and follow its link.
*   **Then**:
    *   They learn that there is no FlowDoc account, server or analytics, and that guides stay on their PC.
    *   They learn that data leaves only if they turn on the optional AI (with their own key) or Save to Notion.
    *   They learn that recording happens only after they press New capture, a recorder bar stays visible, and passwords are never saved.
    *   They can open a privacy page that covers the app they are installing.

### CUJ 3: A user on Linux, or a Chrome-only user, finds their way

*   **Given**: A visitor who can't or won't use the Windows installer.
*   **When**: They follow "Other ways to run FlowDoc".
*   **Then**: They see plainly that Linux means building from source and hasn't been tested on real hardware yet. The extension can be loaded without Node.js (Download ZIP → Load unpacked), and they're told to export a backup before uninstalling it, because uninstalling deletes its guides.

### CUJ 4: An existing user looks for a manual section that moved

*   **Given**: Someone who knew the old README, or who followed a "See the README" link from the v1.1.0 or v1.1.1 release notes.
*   **When**: They open the README looking for, say, "Translate a guide" or the troubleshooting table.
*   **Then**: A "Full manual" link near the top takes them to `docs/user-guide.md`, where the section exists under a findable heading with its content intact.

### CUJ 5: A contributor sets up the project

*   **Given**: A developer who wants to build FlowDoc or send a fix.
*   **When**: They open the Contributing tab, or follow the "Developers" link.
*   **Then**: `CONTRIBUTING.md` tells them to open an issue first and which tests to run, and links to `docs/developers.md`. That page has the prerequisites, build-from-source steps, tests, how the recorder works, the project layout and fixes for build errors.

## Technical Plan (Architecture)

### How the files fit together

The documentation is split by **who is reading**. The landing page is for someone deciding whether to install. The user guide is for someone using FlowDoc. The developers page is for someone building it. Each fact lives in one file, and the other files link to it instead of repeating it.

```text
                         github.com/avin045/FlowDoc
                                    │
                              README.md  (landing page, about 120 lines)
            ┌──────────────┬────────┴─────┬──────────────┬───────────────┐
            ▼              ▼              ▼              ▼               ▼
   Releases page   docs/user-guide.md  PRIVACY.md   CONTRIBUTING.md   LICENSE
   (latest .exe)   (full manual for    (both apps)  (→ developers.md)
                    users)                 ▲
                         │   ▲             │
                         │   └─────────────┤
                         ▼                 │
                   docs/developers.md ─────┘     SECURITY.md (Security tab)
                   (build, tests,
                    internals)

   docs/screenshots/*.png  ← images used by README.md and docs/user-guide.md
   docs/release-notes/*.md → link to docs/user-guide.md
```

### README.md: the landing page

The README is rebuilt from scratch, in this order. The Download badge in block 1 has to sit within the first 450 px of the README box (Goal 1). If it doesn't, the logo is the first thing to cut, since it repeats the H1.

1. **Centered header** (one `<div align="center">` block, closed right after the quick links):
   *   the logo, `extension/icons/logo.svg`, at 96 px
   *   `# FlowDoc`
   *   the tagline: *"Do a task on your PC once. FlowDoc writes the how-to guide for you, with screenshots."*
   *   one badge row: latest release (dynamic, `img.shields.io/github/v/release/avin045/FlowDoc`), license (`img.shields.io/github/license/avin045/FlowDoc`), and a static "platforms: Windows | Linux | Chrome | Edge" badge linking to "Other ways to run FlowDoc". Author decision, 2026-11-08: a Windows-only platform badge would turn away Linux and Mac visitors who can use the extension or build from source.
   *   the Download button: a shields.io `for-the-badge` badge reading "Download for Windows", with the Windows logo, linking to `https://github.com/avin045/FlowDoc/releases/latest`
   *   under the Download button, two smaller badges: "Chrome / Edge extension: any computer" (links to UG › Install the browser extension) and "Linux: build from source" (links to UG › Run FlowDoc on Linux). They are flat, smaller badges, so Windows stays the one main download while the other routes are visible in the header
   *   one quick-link row: Download · User guide · Privacy · Developers

   Inside the `<div>`, Markdown needs a blank line before and after it, and GitHub alerts don't render there. That is why the alert comes after the div.
2. **Download details** (plain text, left-aligned, directly below the header):
   *   one line naming the file: *"On the release page, under **Assets**, click `FlowDoc.Setup.<version>.exe`, not 'Source code'."*
   *   one requirements line: *Windows 10 (version 2004 or newer) or 11 · 64-bit · free and open source (Apache-2.0)*, followed by a "Not on Windows?" line: Linux can build the desktop app from source; on Linux or Mac, the Chrome / Edge extension records anything done in the browser
   *   two or three lines on install warnings, linking to the full steps: *"Your browser or Windows may warn you, because FlowDoc is free and doesn't pay for a code-signing certificate. The source code is public. [What to click](docs/user-guide.md#if-your-browser-or-windows-warns-you)."*
3. **Hero image:** `docs/screenshots/home-light.png`, full width, with alt text describing the screen.
4. **Privacy note:** the only GitHub alert on the page (`> [!NOTE]`). *"No FlowDoc account, no FlowDoc server, no analytics. Your guides stay on your PC. Data leaves only if you turn on the optional AI (your own Gemini or Groq key) or Save to Notion."* It links to `PRIVACY.md`, and has one more line: *"FlowDoc records only after you press New capture, a recorder bar stays visible, and passwords are never saved."*
5. **How it works:** a three-column table, one cropped screenshot per column, each with a plain-text caption underneath (*1. Start a capture* · *2. Edit the steps* · *3. Export to PDF, Word, HTML or Markdown*). The captions are Markdown text, not text inside the images, so they stay readable and searchable. The images are tight crops, not the full dimmed windows, which can't be read at about 270 px per column:
   *   `docs/screenshots/how-capture.png`: the "Start a capture" dialog only
   *   `docs/screenshots/how-edit.png`: the editor's guide card, with the title, step 1 and its screenshot
   *   `docs/screenshots/how-export.png`: the "Export guide" dialog only

   They're made the same way as the other screenshots: the current desktop app with a throwaway data folder and the sample guide, using Playwright element screenshots of the dialog and the guide card.
6. **Features:** a two-column table.
   *   **Works right away:** record any Windows app; record the whole screen, an area or chosen apps; edit steps; blur and crop; export to PDF, Word, HTML, Markdown or a JSON backup; light and dark theme; passwords kept out.
   *   **Optional, needs setup:** Improve with AI and Translate (your own free Gemini or Groq key); Save to Notion (connect your Notion).
7. **Other ways to run FlowDoc:**
   *   Chrome / Edge extension: no install tools needed; link to the user guide section.
   *   Linux: build from source, not yet tested on real hardware; link to the developers page.
   *   Try the editor in a browser (developers page, web workspace).
8. **Documentation:** *"The full manual moved to [docs/user-guide.md](docs/user-guide.md)."* plus links to the developers page and the release notes.
9. **Footer:** Contributing · Security · License (Apache-2.0, "Copyright 2026 avin045") · *"FlowDoc is an alternative to tools like Scribe. It is not affiliated with Scribe."*

The README doesn't mention Node.js, Git, npm, `git clone`, Electron, DPAPI, AppImage, X11 or MV3 (Goal 2). It doesn't name a specific version except through the badge (Goal 8).

### docs/user-guide.md: the manual for users

One H1, then H2s in the order a user needs them, with H3s (and a few H4s) below them and no skipped levels. The overview below shows the H2 order. The exact heading list, with every H3 and H4 and its anchor, is in Detailed Implementation item 3, and that list is the reference. Headings are plain English, unique within the file, and contain no numbers, emoji or symbols, so GitHub's anchors stay readable and stable.

```text
# FlowDoc user guide
## Which version should I use?            (desktop app vs extension table, requirements)
## Install the desktop app on Windows
   ### Download and run the installer
   ### If your browser or Windows warns you   (browser warning, SmartScreen, Smart App Control, why)
   ### After you install                      (first capture, updates, where guides go)
   ### Uninstall the desktop app
## Run FlowDoc on Linux                    (short: build from source → developers.md)
## Install the browser extension            (Download ZIP → Load unpacked; no Node.js)
   ### Update the extension
   ### Change the keyboard shortcut
   ### Uninstall the extension              (export a backup first: uninstalling deletes guides)
## Record a guide
   ### Record with the desktop app
   ### Record only an area or only some apps
   ### Record with the extension
   ### Add more steps later
   ### What FlowDoc writes for each action  (desktop and extension subsections)
   ### Capture settings
## Edit a guide                             (title, steps, blocks, blur/crop/highlight, more room)
## Export and share a guide                 (five formats, Copy, Print)
## Manage your guides                       (library, where guides are stored, your own folder,
                                             sample guide, light and dark theme)
## Improve and translate with AI (optional) (desktop and extension merged; Gemini/Groq setup)
## Save guides to Notion (optional)         (desktop and extension merged)
## Privacy and passwords                    (what is recorded, password protection and its limits)
## Troubleshooting                          (desktop, extension, antivirus row)
## Limitations
```

Merging the desktop and extension versions of AI and Notion into one section each removes the duplicate A5/B5 and A6/B6 text that exists today. Where the two apps behave differently (for example, where keys are stored), the section says so in a short "Desktop app / Extension" table.

Screenshots go next to the steps they illustrate:

| Screenshot | Section |
| --- | --- |
| `new-capture.png` | Record with the desktop app |
| `guide-editor.png` | Edit a guide |
| `export.png` | Export and share a guide |
| `library.png`, `home-dark.png` | Manage your guides |
| `settings-1.png` (General), `settings-capture.png` | Capture settings |
| `settings-storage.png` | Where your guides are stored |
| `settings-2.png` (AI) | Improve and translate with AI |
| `settings-integrations.png` | Save guides to Notion |

### docs/developers.md: the manual for builders

```text
# FlowDoc for developers
## What you need                    (Node.js, Git, disk space, OS requirements)
## Get the code
## Run the desktop app from source
## Build the installers
## Linux one-time setup
## Load the extension from source   (including updating after a pull)
## Web workspace                    (npm run serve, demo site)
## Tests
## How the desktop recorder works
## How passwords are kept out of guides
## Project layout
## Build errors                     (EBUSY, elevate.exe rows moved from troubleshooting)
```

### Content corrections applied while moving

These come from the brainstorm review. Each one is fixed in the new text, not copied over:

*   **Privacy wording:** the qualified claim (data leaves only through optional AI or Notion), everywhere it appears.
*   **Notion:** described as available in both apps.
*   **Extension install:** no `npm install` step; `extension/vendor/` is committed.
*   **Export formats:** exactly five (PDF, Word, HTML, Markdown, Backup JSON). Print and Copy are sharing actions, not formats.
*   **Install warnings:** the browser download warning, SmartScreen and Smart App Control, written once and linked from everywhere else.
*   **Linux:** "build from source, not yet tested on real hardware"; keys without a keyring are only obfuscated (`extension/app/desktop.js` text).
*   **No auto-update:** "FlowDoc doesn't update itself; run the newer installer, your guides are kept."
*   **Data folders:** installed and from-source runs use different folders (`%APPDATA%\FlowDoc` vs `%APPDATA%\flowdoc`). Mentioned in "Where your guides are stored".
*   **Removed:** troubleshooting rows about bugs fixed in earlier versions, and the dated "October 2026" model note. The build-error rows move to developers.md.
*   **Scribe:** the "in the style of Scribe (scribehow.com)" link is removed; the README footer carries the comparison and the "not affiliated" line.
*   **Old product name:** none written in any changed file.

### PRIVACY.md: one policy for both apps

The section structure stays the same (Summary, What FlowDoc records, Where your data is stored, Optional features that send data, Export, What we don't do, Permissions, Children, Changes, Contact). The rule is that **every sentence that is true for only one app says which app**:
* Sections where the apps differ ("What FlowDoc records", "Where your data is stored") get a "Desktop app" part and an "Extension" part. The extension's current wording is kept word for word inside its part, so the future Web Store listing still describes the extension correctly.
* Sentences that today say "your browser" but apply to both apps (the Summary, the Optional features intro, Export, "What we don't do") are reworded to cover both.
* "Permissions" becomes "Permissions (browser extension)".

The exact replacement text, line by line, is in Detailed Implementation item 5. The desktop facts it adds:

*   **What FlowDoc records:**
    *   clicks and keys through a system-wide keyboard and mouse hook that runs only during a capture
    *   typed text, unless "Include typed text in steps" is turned off; passwords are never stored
    *   the app and window name, and the button or field name, read through Windows UI Automation or the Linux accessibility interface
    *   in a web browser, the page address and title for "Navigate to" steps
    *   a screenshot of the screen, area or app window for each step
*   **Where data is stored:**
    *   guides and screenshots as files in the guides folder; settings in the app's data folder
    *   keys and the Notion secret encrypted by the operating system (DPAPI on Windows; GNOME Keyring or KWallet on Linux), or only obfuscated when Linux has no keyring
    *   uninstalling keeps the guides until the data folder is deleted

Every desktop fact is traced to the code before merge. The completeness check compares the policy with the fields that `desktop/recorder.js` stores for each step (Verification Plan).

### CONTRIBUTING.md and SECURITY.md

*   **`CONTRIBUTING.md`** (root, about 30 lines): open an issue before a large change; run `npm test` and `npm run test:desktop`; keep docs in plain English; never write the project's old product name in new code or docs; the full setup is in `docs/developers.md`. GitHub shows it as the "Contributing" tab.
*   **`SECURITY.md`** (root, about 20 lines): what counts as a security problem (for example, a key or secret leaving the PC unexpectedly, a password appearing in a guide, recording outside a capture, or code running when a guide or backup file is opened or imported); replies are best effort, with no fixed timeframe; report it privately through GitHub (Security → Report a vulnerability); don't open a public issue; which version is supported (the latest release only). GitHub shows it as the "Security" tab. Turning on private vulnerability reporting is a repo setting (see below).

### Links and anchors

*   All links between files are relative, and written **relative to the file the link sits in** (`docs/user-guide.md#…` from the README, `developers.md#…` between the two docs files, `../PRIVACY.md` from `docs/`). The only absolute URLs are the Releases page, the badge images and the release-note link. The full path rules are in the Detailed Implementation.
*   GitHub builds each anchor from its heading: lowercase; characters other than letters, digits, spaces, `-` and `_` removed; spaces turned into `-`; repeated headings get `-1`, `-2`. Because the headings are unique and have no symbols, each anchor is predictable.
*   The 25 body links that jump to a heading are rewritten to their new file and anchor using the link rewrite table in the Detailed Implementation. The 11 links in Contents are removed with it.
*   Check: one run of a Markdown link checker over all changed `.md` files, then a click-through of every link that jumps between files on the rendered branch. GitHub doesn't report a missing anchor, so a link checker run that verifies anchors is required, not optional.

### Repository settings and published releases

These changes live on GitHub, not in the diff. They run **after** the pull request is merged, because the links they set point at files that exist only on `main` after the merge.

*   `gh repo edit avin045/FlowDoc --description "<tagline>" --homepage https://github.com/avin045/FlowDoc/releases/latest --enable-wiki=false --add-topic scribe-alternative,step-recorder,how-to-guide,screenshot,sop,documentation,local-first,offline,privacy,windows,electron,chrome-extension`. The value to restore if needed: description "Step by Step Guide Creator", no homepage, no topics, wiki on.
*   Turn on private vulnerability reporting (`gh api -X PUT repos/avin045/FlowDoc/private-vulnerability-reporting`).
*   Edit the published v1.1.0 and v1.1.1 release descriptions: save the current text first (`gh release view <tag> --json body -q .body > <tag>.orig.md`) as the rollback copy, replace only the "See the README" sentence, and upload the edited copy (`gh release edit <tag> --notes-file <tag>.new.md`).
*   Optional, by hand in the GitHub web interface: upload a social preview image (1280×640). Not required by any goal.

Each of these changes something public, so each command is shown to the author and run only after their OK.

### Rollout

1. Create a branch `docs/landing-page` from `main`.
2. Commit in the seven phases listed in the Detailed Implementation:
   1. screenshots, including the 3 "How it works" crops
   2. user guide and developers pages
   3. `PRIVACY.md`
   4. `CONTRIBUTING.md` and `SECURITY.md`
   5. `README.md`
   6. release notes and this design
   7. after merge

   Each phase has a checkpoint that must pass before the next.
3. The author checks the install steps on a Windows machine. Open a pull request and run the rendered review (themes, phone width, Goal 1, images).
4. Squash-merge. Then apply the repository settings and release-description edits, and run the after-merge checks: the Contributing and Security tabs, the About box, and the release links.
5. Rollback: revert the merge commit. Restore the old repository settings with the values above, and the release descriptions from the saved `<tag>.orig.md` files.

## Changes after implementation

**Separate installation guide, and install panels in the README** (author decision, 2026-11-08, after the first implementation commit).

*   **New file `docs/installation.md`.** "Which version should I use?" and the three install sections moved out of `docs/user-guide.md` into their own file:
    *   **Windows:** download, warnings, after you install, uninstall
    *   **Linux:** build and install, where guides are stored, uninstall
    *   **Chrome and Edge extension:** install, update, keyboard shortcut, uninstall

    The user guide now starts at "Record a guide" and links to the installation guide.
*   **README "Install" section.** It replaces the "Download" block and the "Other ways to run FlowDoc" section. GitHub Markdown has no tabs, so the three platforms are collapsible `<details>` panels; Windows is open by default. Each panel has the short steps and links to its section of `docs/installation.md`.
*   **Badges.** The platforms badge and the two smaller badges (extension, Linux) link to `#install` and `docs/installation.md`.
*   **Updated anchors.** These anchors from the plan above now live in `docs/installation.md`, not `docs/user-guide.md`:

    | Old anchor (user guide) | New anchor (installation guide) |
    | --- | --- |
    | `#install-the-desktop-app-on-windows` | `#windows` |
    | `#run-flowdoc-on-linux` | `#linux` |
    | `#install-the-browser-extension` | `#chrome-and-edge-extension` (install steps under `#install-the-extension`) |
    | `#if-your-browser-or-windows-warns-you` | unchanged name, new file |
    | `#update-the-extension`, `#change-the-keyboard-shortcut`, `#uninstall-the-extension`, `#uninstall-the-desktop-app`, `#after-you-install`, `#download-and-run-the-installer`, `#which-version-should-i-use` | unchanged names, new file |

*   **Checked:** the link check passes over all docs. The README, rendered by GitHub's Markdown API, shows the three panels, and the Download badge sits 307 px from the top of the README box (Goal 1: within 450 px).

## Alternatives Considered

### Alternative A: An animated GIF at the top of the README

*   **Pros**: Shows the one thing a still image can't: you do a task, and the guide writes itself.
*   **Cons**: Someone has to record and trim it, and re-record it whenever the UI changes. GitHub won't display images over 10 MB.
*   **Reason for Rejection**: Rejected by author: the current screenshots are enough for now. A GIF can replace the hero image later without changing anything else on the page.

### Alternative B: A GIF taken from Tenor

*   **Pros**: No recording work.
*   **Cons**: It wouldn't show FlowDoc, so it proves nothing about the product. Tenor's license covers sharing inside chat apps, not copying the file into an Apache-2.0 repository.
*   **Reason for Rejection**: Rejected by author after review, for both reasons.

### Alternative C: A GitHub Pages site

*   **Pros**: A short web address and a page outside GitHub's layout. Could host the web editor with its sample guide as a "try it in your browser" demo.
*   **Cons**: As a brochure, it's a second copy of the README for one maintainer to keep in sync. As a live demo, it probably needs a code change so the editor works from a `/FlowDoc/` subpath, which breaks the docs-only boundary.
*   **Reason for Rejection**: Deferred by author. If it comes back, the demo version is the one worth building.

### Alternative D: Three equal download buttons (Windows, Linux, extension)

*   **Pros**: Treats every platform the same.
*   **Cons**: Linux needs building from source, and the extension needs Developer mode. Equal buttons would send non-technical users to installs they can't finish.
*   **Reason for Rejection**: Rejected by author: one Windows button, and the other routes go under "Other ways to run FlowDoc", labeled honestly.

### Alternative E: Download-count and "featured" badges

*   **Pros**: Social proof, as on popular projects.
*   **Cons**: The release has about 3 downloads, and a badge showing that number hurts credibility. FlowDoc hasn't earned any featured or trending badges.
*   **Reason for Rejection**: Rejected by author. Add them once the numbers are real and worth showing.

### Alternative F: A direct one-click download link

*   **Pros**: The button downloads the installer directly, with no detour through the release page and no risk of clicking "Source code".
*   **Cons**: Needs version-free installer file names, which means a `build.<target>.artifactName` change in `package.json` and a new release. That breaks the "no build changes" boundary.
*   **Reason for Rejection**: Deferred by author. Each build target can get its own name (`FlowDoc-Setup.exe`, `FlowDoc-Portable.exe`, `FlowDoc-x86_64.AppImage`, `flowdoc_amd64.deb`), so adding Linux later doesn't conflict.

### Alternative G: Eight docs pages split by task, plus an index

*   **Pros**: Each page is short; easier to link to one topic.
*   **Cons**: Eight files and an index for one maintainer to keep consistent. More links between files, which break more often.
*   **Reason for Rejection**: Rejected by author: keep the docs minimal. Two files, a user guide and a developers page, with a section split out later only if it becomes hard to use.

### Alternative H: Docs split by app (desktop app page, extension page)

*   **Pros**: Matches today's "Guide A / Guide B" layout, so moving content is easier.
*   **Cons**: Keeps the duplicate AI and Notion instructions (A5/B5, A6/B6) on two pages that drift apart.
*   **Reason for Rejection**: Rejected by author after review. The user guide merges shared features and notes the differences in small tables.

### Alternative I: Keep the "A1"–"C11" heading numbers

*   **Pros**: Anchors stay the same, so each link only needs a file name added in front.
*   **Cons**: Reads like a legal code to plain-English readers. Adding a section later means renumbering, which breaks links again.
*   **Reason for Rejection**: Rejected by author: plain headings, with the 25 body links rewritten and checked.

### Alternative J: A designed hero banner rendered by a script

*   **Pros**: Looks like the BitChord example: the real screenshot in a window frame on a branded background, rendered by a Playwright script that can be re-run, and reusable as the social preview image.
*   **Cons**: A script and an HTML template to maintain, plus rules to keep them out of the installer and away from `scripts/icons.mjs`.
*   **Reason for Rejection**: Rejected by author: `home-light.png` is used as it is.

### Alternative K: CODE_OF_CONDUCT.md

*   **Pros**: Adds GitHub's "Code of conduct" tab and signals a community project.
*   **Cons**: Needs a real public contact for reports. For a solo maintainer that means a personal email address in a public file. Unenforced, it's worse than none.
*   **Reason for Rejection**: Rejected by author: SECURITY.md with GitHub private reporting covers the risk that matters for an app that stores keys and records the screen.

### Alternative L: Keep `PRIVACY.md` extension-only

*   **Pros**: The Web Store policy stays narrow, and nothing changes for that listing.
*   **Cons**: The main download, the desktop app, would have no formal privacy policy, only a manual section.
*   **Reason for Rejection**: Rejected by author: one policy covers both apps, and the extension's text stays unchanged inside it.

### Alternative M: A committed SVG Download button

*   **Pros**: Larger than the status badges, and served from the repo with no outside service.
*   **Cons**: One more file to edit, and SVG text depends on the viewer's fonts unless it's converted to outlines.
*   **Reason for Rejection**: Rejected by author: a shields.io `for-the-badge` badge needs no file.

### Alternative N: Leave the old release notes unchanged

*   **Pros**: Published history stays frozen, and nothing outside the repo changes.
*   **Cons**: "See the README" in v1.1.0 and v1.1.1 would land on the landing page instead of the manual.
*   **Reason for Rejection**: Rejected by author: edit the sentence in both files and both published releases, after the merge.

### Alternative O: The `self-hosted` topic

*   **Pros**: A popular topic that many people search.
*   **Cons**: FlowDoc has no server; `npm run serve` is only a local dev server. The topic would mislead people looking for self-hosted server software.
*   **Reason for Rejection**: Rejected by author after review. `local-first` and `offline` describe FlowDoc accurately.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy:** The new text must not claim more privacy than the code provides. Every sentence in `PRIVACY.md` and the README privacy note is checked against `desktop/` and `extension/shared/` before merge. Screenshots show no real user data: the 2026-11-08 set came from a throwaway data folder, uses the built-in sample guide, and shows `C:\Users\you\…` in place of the real Windows user name.
*   **Rollout & Rollback:** One pull request, squash-merged. Repository settings and release-description edits run after the merge and can be undone with the values recorded in the Technical Plan.

## Detailed Implementation Plan

### Phases and checkpoints

Each phase is one commit on the branch `docs/landing-page`. A phase is done only when its checkpoint passes. The file sections below follow the same order.

| Phase | Files | Checkpoint before the next phase |
| --- | --- | --- |
| 1. Screenshots | The 11 files in item 1, and the 3 crops in item 2 | Every file opens. No real Windows user name, real app list or real guide is visible. Each crop is ≤ 1200 px wide and ≤ 200 KB. |
| 2. Manual | `docs/user-guide.md`, `docs/developers.md` | Link check on both files passes. Every mapping row is ticked off. The version, `npm` and old-name searches pass for both files. Headings match the outlines in item 3 and item 4 exactly. |
| 3. Privacy policy | `PRIVACY.md` | Every desktop sentence is traced to code (Verification Plan). No sentence describes browser-only behaviour without saying "the extension". |
| 4. Community files | `CONTRIBUTING.md`, `SECURITY.md` | Link check passes. |
| 5. Landing page | `README.md` | The Goal 2 searches pass. The link check over all files passes. The badges render. |
| 6. Notes and design | `docs/release-notes/v1.1.0.md`, `docs/release-notes/v1.1.1.md`, `docs/designs/readme-landing-page.md` | Link check passes. `git diff --stat main...HEAD` lists only `.md` and `.png` files. |
| 7. After merge | GitHub settings, published release descriptions | The checks under "After merge" in the Verification Plan pass. |

### Mapping of every current heading

Every heading in today's `README.md` (57 including the title) and where its content goes. "UG" is `docs/user-guide.md`, "DEV" is `docs/developers.md`. Headings are quoted exactly as they appear in `README.md`.

**Removal rule:** text moves and is reworded in plain English. Nothing is dropped except:
* rows marked **Removed**;
* the corrections named in the Notes column of rows 1, 9, 25, 28 and 36, which replace wrong text with correct text.

| # | Current heading (line) | New location | Notes |
| --- | --- | --- | --- |
| 1 | `# FlowDoc` and intro (1–5) | README header, tagline, privacy note | Correction: "in the style of Scribe (scribehow.com)" is replaced by the footer line "FlowDoc is an alternative to tools like Scribe. It is not affiliated with Scribe." |
| 2 | Contents (7) | **Removed** | GitHub's outline menu replaces it. Its 11 links go with it. |
| 3 | Screenshots (22) | README hero (`home-light.png`); other images placed per the Technical Plan table | Captions rewritten for the new Settings tabs |
| 4 | 1. Before you start: what you need (50) | DEV › What you need; UG › Which version should I use? | Node.js and Git go only to DEV. The operating-system requirements go to UG. |
| 5 | Required (54) | DEV › What you need | |
| 6 | For the desktop app (77) | UG › Which version should I use? | Requirements list |
| 7 | For the browser extension (83) | UG › Which version should I use? | |
| 8 | Optional (87) | UG › Set up AI; UG › Save guides to Notion (optional) | One "What you need" line in each |
| 9 | 2. Which version should I use? (96) | UG › Which version should I use? | Correction: the table cell "Run from source, or build an installer" becomes "Download the installer from the Releases page (Windows); build from source (Linux)" |
| 10 | 3. Get the code (116) | DEV › Get the code | |
| 11 | Guide A: Desktop app (Windows and Linux) (136) | Dissolved | Its subsections move as listed below |
| 12 | A1. Install (138) | UG › Install the desktop app on Windows | Rewritten around the Releases download |
| 13 | Option 1: Run it from the source code (quickest) (140) | DEV › Run the desktop app from source | |
| 14 | Option 2: Build and install it like a normal program (150) | DEV › Build the installers; UG › Download and run the installer; UG › Run FlowDoc on Linux | How to build goes to DEV, with `<version>` placeholders (item 4). Using the Windows installer goes to UG. Using the AppImage or `.deb` goes to UG › Run FlowDoc on Linux. |
| 15 | Linux: one-time setup (176) | DEV › Linux one-time setup | UG › Run FlowDoc on Linux links here |
| 16 | A2. Record your first guide (194) | UG › Record with the desktop app | |
| 17 | Record only an area or only some apps (217) | UG › Record only an area or only some apps | |
| 18 | A3. What the desktop app writes for each action (238) | UG › What FlowDoc writes for each action › Desktop app actions | |
| 19 | A4. Privacy while recording (260) | UG › Privacy and passwords | |
| 20 | A5. Optional: AI write-ups with Gemini or Groq (268) | UG › Set up AI; UG › Improve a guide with AI | **Removed:** the dated "October 2026" model note |
| 21 | A6. Optional: Save guides to Notion (324) | UG › Save guides to Notion (optional) | |
| 22 | A7. Capture settings (363) | UG › Capture settings | |
| 23 | A8. Where your guides are stored (375) | UG › Where your guides are stored | Keeps the installed vs from-source folder table, Windows rows only. The Linux rows go to UG › Run FlowDoc on Linux. |
| 24 | Use your own guides folder (389) | UG › Use your own guides folder | |
| 25 | A9. Troubleshooting (desktop) (407) | UG › Desktop app problems | **Removed:** the three "Fixed in this version" rows (README.md:421, 426, 427). The still-valid tip from row 426 ("If anything ever gets stuck, press Alt+Shift+R to stop the capture") becomes its own row: "A capture seems stuck". The EBUSY and elevate.exe rows move to DEV › Build errors. Correction: the SmartScreen row links to UG › If your browser or Windows warns you. An antivirus row is added (item 3). |
| 26 | A10. Uninstall (431) | UG › Uninstall the desktop app (Windows); UG › Run FlowDoc on Linux (Linux) | |
| 27 | Guide B: Chrome / Edge extension (440) | Dissolved | |
| 28 | B1. Install the extension (444) | UG › Install the browser extension | Correction: the `npm install` step is replaced by the no-tools steps in item 3 |
| 29 | B2. Record your first guide (456) | UG › Record with the extension | |
| 30 | B3. What the extension writes for each action (472) | UG › What FlowDoc writes for each action › Extension actions | |
| 31 | B4. Find your guides again (491) | UG › Manage your guides | |
| 32 | B5. Optional: AI (Improve and Translate) in the extension (497) | UG › Set up AI | Merged; the differences go in a Desktop app / Extension table |
| 33 | B6. Optional: Save to Notion from the extension (507) | UG › Save guides to Notion (optional) | Merged |
| 34 | B7. Change the keyboard shortcut (517) | UG › Change the keyboard shortcut | |
| 35 | B8. Update the extension after pulling new code (521) | UG › Update the extension; DEV › Load the extension from source | UG: the safe update steps in item 3. DEV: `git pull`, then reload. |
| 36 | B9. Troubleshooting (extension) (527) | UG › Extension problems | Correction: the "Load unpacked … missing files" row ("Run `npm install` first") becomes "You selected the wrong folder: choose the `extension` folder, the one that contains `manifest.json`" |
| 37 | B10. Uninstall (537) | UG › Uninstall the extension | Keeps "export backups first" |
| 38 | Guide C: Editing and exporting a guide (543) | UG › Edit a guide (intro sentence) | |
| 39 | C1. Title and description (547) | UG › Title and description | |
| 40 | C2. Edit a step (552) | UG › Edit a step | |
| 41 | C3. Add, move and delete blocks (558) | UG › Add, move and delete blocks | |
| 42 | C4. Blur private information, crop, or change the highlight (572) | UG › Blur, crop or change the highlight | |
| 43 | C5. Export (599) | UG › Export and share a guide | Exactly five formats. Copy and Print are described as sharing actions. |
| 44 | C6. Try it without recording (627) | UG › Try the sample guide | |
| 45 | C7. Light and dark mode (631) | UG › Light and dark mode | |
| 46 | C8. Manage your library (640) | UG › Manage your guides | |
| 47 | C9. Add more steps later (Continue capturing) (648) | UG › Add more steps later | |
| 48 | C10. Translate a guide (660) | UG › Translate a guide | |
| 49 | C11. More room for the guide (hide the side panels) (687) | UG › Hide the side panels | |
| 50 | Web workspace (no install) (695) | DEV › Web workspace | |
| 51 | For developers (705) | DEV (whole file) | |
| 52 | Tests (707) | DEV › Tests | |
| 53 | How the desktop recorder works (735) | DEV › How the desktop recorder works | |
| 54 | How passwords are kept out of guides (744) | DEV › How passwords are kept out of guides | A plain-English summary of the limits ("password fields FlowDoc can't detect") also goes in UG › Privacy and passwords |
| 55 | Project layout (759) | DEV › Project layout | |
| 56 | Limitations (799) | UG › Limitations | |
| 57 | License (816) | README › License (footer) | |

### Link rewrite table

`README.md` has 36 links to anchors on its own page, on 34 lines:
* 11 are in Contents (lines 9–20). They are removed with Contents (row 2).
* The other 25 are in the body and use 17 distinct anchors. Each is rewritten below.

"Lands in" is the file the link's sentence moves to. "Write as" is written **relative to that file**.

**Self-link rule:** when a link would point at the section it already sits in (because two sections were merged), delete the link and keep the sentence, worded as "above" or "below" if needed.

| Old line | Old anchor | Lands in | Write as |
| --- | --- | --- | --- |
| 80 | `#linux-one-time-setup` | UG › Which version should I use? | `developers.md#linux-one-time-setup` |
| 118 | `#1-before-you-start-what-you-need` | DEV › Get the code | `#what-you-need` |
| 201 | `#record-only-an-area-or-only-some-apps` | UG › Record with the desktop app | `#record-only-an-area-or-only-some-apps` |
| 210 | `#a7-capture-settings` | UG › Record with the desktop app | `#capture-settings` |
| 213 | `#guide-c-editing-and-exporting-a-guide` | UG › Record with the desktop app | `#edit-a-guide` |
| 262 | `#how-passwords-are-kept-out-of-guides` | UG › Privacy and passwords | `developers.md#how-passwords-are-kept-out-of-guides` |
| 263 | `#a7-capture-settings` | UG › Privacy and passwords | `#capture-settings` |
| 265 | `#c4-blur-private-information-crop-or-change-the-highlight` | UG › Privacy and passwords | `#blur-crop-or-change-the-highlight` |
| 270 (first) | `#c10-translate-a-guide` | UG › Set up AI | `#translate-a-guide` |
| 270 (second) | `#b5-optional-ai-improve-and-translate-in-the-extension` | UG › Set up AI | Self-link: delete |
| 316 | `#c4-blur-private-information-crop-or-change-the-highlight` | UG › Improve a guide with AI | `#blur-crop-or-change-the-highlight` |
| 326 | `#b6-optional-save-to-notion-from-the-extension` | UG › Save guides to Notion (optional) | Self-link: delete |
| 411 | `#linux-one-time-setup` | UG › Desktop app problems | `developers.md#linux-one-time-setup` |
| 436 | `#a8-where-your-guides-are-stored` | UG › Uninstall the desktop app | `#where-your-guides-are-stored` |
| 442 | `#guide-a-desktop-app-windows-and-linux` | UG › Install the browser extension | `#install-the-desktop-app-on-windows` |
| 468 | `#guide-c-editing-and-exporting-a-guide` | UG › Record with the extension | `#edit-a-guide` |
| 495 | `#c8-manage-your-library` | UG › Manage your guides | Self-link: delete |
| 502 | `#a5-optional-ai-write-ups-with-gemini-or-groq` | UG › Set up AI | Self-link: delete |
| 511 | `#a6-optional-save-guides-to-notion` | UG › Save guides to Notion (optional) | Self-link: delete |
| 513 | `#a6-optional-save-guides-to-notion` | UG › Save guides to Notion (optional) | Self-link: delete |
| 515 | `#b5-optional-ai-improve-and-translate-in-the-extension` | UG › Save guides to Notion (optional) | `#improve-and-translate-with-ai-optional` |
| 534 | `#b7-change-the-keyboard-shortcut` | UG › Extension problems | `#change-the-keyboard-shortcut` |
| 664 (first) | `#a5-optional-ai-write-ups-with-gemini-or-groq` | UG › Translate a guide | `#set-up-ai` |
| 664 (second) | `#b5-optional-ai-improve-and-translate-in-the-extension` | UG › Translate a guide | Same target as the first: merge both into one `#set-up-ai` link |
| 685 | `#c5-export` | UG › Translate a guide | `#export-and-share-a-guide` |

Eight anchors appear only in Contents and have **no surviving link**: `#screenshots`, `#2-which-version-should-i-use`, `#3-get-the-code`, `#guide-b-chrome--edge-extension`, `#web-workspace-no-install`, `#for-developers`, `#limitations`, `#license`. Nothing points at them after the change.

**Path rules for new links and images:**

| From | To | Write as |
| --- | --- | --- |
| `README.md` | the docs | `docs/user-guide.md#…`, `docs/developers.md#…` |
| `README.md` | an image | `docs/screenshots/x.png` |
| `docs/user-guide.md` | `docs/developers.md` | `developers.md#…` |
| `docs/developers.md` | `docs/user-guide.md` | `user-guide.md#…` |
| `docs/*.md` | an image | `screenshots/x.png` |
| `docs/*.md` | a root file | `../PRIVACY.md`, `../README.md#license`, `../CONTRIBUTING.md` |
| root community files | the docs | `docs/developers.md` |

### Target Files to Create/Modify

#### 1. Screenshots (7 Modify, 4 Create; already in the working tree)

*   **Files:**
    *   Modify: `docs/screenshots/home-light.png`, `docs/screenshots/home-dark.png`, `docs/screenshots/new-capture.png`, `docs/screenshots/guide-editor.png`, `docs/screenshots/export.png`, `docs/screenshots/settings-1.png` (now the General tab), `docs/screenshots/settings-2.png` (now the AI tab).
    *   Create: `docs/screenshots/library.png`, `docs/screenshots/settings-capture.png`, `docs/screenshots/settings-storage.png`, `docs/screenshots/settings-integrations.png`.
*   **Proposed Changes**: None further. They were captured on 2026-11-08 from the current desktop app with a throwaway data folder, using the method in item 2.
*   **Caption note:** `settings-storage.png` shows `C:\Users\you\AppData\Roaming\flowdoc\library`, the folder used when running from source. Its caption in UG says: "Installed copies use `%APPDATA%\FlowDoc` instead."
*   **Why**: The old editor, export and Settings shots showed UI from before v1.1.1 ("Copy text", single-page Settings, "system keychain" wording).

#### 2. `docs/screenshots/how-capture.png`, `docs/screenshots/how-edit.png`, `docs/screenshots/how-export.png` (Create)

*   **Type / Scope**: Images for the README "How it works" row.
*   **Method** (an uncommitted Node script that uses the `playwright` devDependency already in `package.json`; nothing is added to the repo):
    1. Create an empty temporary folder.
    2. Launch the app with `_electron.launch` from `playwright`: `executablePath` set to the path that `require('electron')` returns, `args: ['.']`, the repo root as working directory, and environment variable `FLOWDOC_USER_DATA` set to the temporary folder (read at `desktop/main.js:25`).
    3. Use the window whose URL starts with `app://flowdoc/app.html`. Set its content size to 1346×780 (`BrowserWindow.setContentSize`, through `app.evaluate`), and click `[data-theme-mode="light"]`.
    4. Before each shot, move the mouse to (2, 2) so nothing shows a hover state, and wait 600 ms for animations.
    5. **how-capture:**
        * Click `[data-act="capture"]` (the "New capture" button on the empty home screen).
        * Screenshot the element `dialog[open]`.
        * Leave the default "Whole screen" option selected. Never click "Specific apps": it lists the real open windows.
        * Click "Cancel".
    6. **how-edit:**
        * Click `[data-act="sample"]` and set the content size to 1522×780.
        * Take a page screenshot clipped to `article.doc`. The clip runs from the top of `article.doc` to 16 px below the bottom of the first `.blocks > .block`, so it shows the title, the description and step 1 with its screenshot.
    7. **how-export:**
        * Click `[data-act="export"]` and screenshot the element `dialog[open]`.
        * Press Escape and close the app.
    8. Each output must be ≤ 1200 px wide and ≤ 200 KB. If one is larger, scale it down to 1200 px wide.
*   **Why**: Author decision, 2026-11-08: "How it works" uses screenshots. The full-window shots are dimmed behind dialogs and unreadable at README column width.

#### 3. `docs/user-guide.md` (Create)

*   **Type / Scope**: User documentation.
*   **Content sources:** mapping rows 3, 4 (operating-system requirements only), 6–9, 12, 14 (installer and Linux package use), 16–49 except row 38's heading, 25 (except the two build-error rows), 54 (summary only), and 56.
*   **Exact outline** (this is the reference for every heading check; anchors in brackets):

    ```text
    # FlowDoc user guide
    ## Which version should I use?                  [#which-version-should-i-use]
    ## Install the desktop app on Windows           [#install-the-desktop-app-on-windows]
    ### Download and run the installer             [#download-and-run-the-installer]
    ### If your browser or Windows warns you        [#if-your-browser-or-windows-warns-you]
    ### After you install                           [#after-you-install]
    ### Uninstall the desktop app                   [#uninstall-the-desktop-app]
    ## Run FlowDoc on Linux                         [#run-flowdoc-on-linux]
    ## Install the browser extension                [#install-the-browser-extension]
    ### Update the extension                        [#update-the-extension]
    ### Change the keyboard shortcut                [#change-the-keyboard-shortcut]
    ### Uninstall the extension                     [#uninstall-the-extension]
    ## Record a guide                               [#record-a-guide]
    ### Record with the desktop app                 [#record-with-the-desktop-app]
    ### Record only an area or only some apps       [#record-only-an-area-or-only-some-apps]
    ### Record with the extension                   [#record-with-the-extension]
    ### Add more steps later                        [#add-more-steps-later]
    ### What FlowDoc writes for each action         [#what-flowdoc-writes-for-each-action]
    #### Desktop app actions                        [#desktop-app-actions]
    #### Extension actions                          [#extension-actions]
    ### Capture settings                            [#capture-settings]
    ## Edit a guide                                 [#edit-a-guide]
    ### Title and description                       [#title-and-description]
    ### Edit a step                                 [#edit-a-step]
    ### Add, move and delete blocks                 [#add-move-and-delete-blocks]
    ### Blur, crop or change the highlight          [#blur-crop-or-change-the-highlight]
    ### Hide the side panels                        [#hide-the-side-panels]
    ## Export and share a guide                     [#export-and-share-a-guide]
    ## Manage your guides                           [#manage-your-guides]
    ### Where your guides are stored                [#where-your-guides-are-stored]
    #### Use your own guides folder                 [#use-your-own-guides-folder]
    ### Try the sample guide                        [#try-the-sample-guide]
    ### Light and dark mode                         [#light-and-dark-mode]
    ## Improve and translate with AI (optional)     [#improve-and-translate-with-ai-optional]
    ### Set up AI                                   [#set-up-ai]
    ### Improve a guide with AI                     [#improve-a-guide-with-ai]
    ### Translate a guide                           [#translate-a-guide]
    ## Save guides to Notion (optional)             [#save-guides-to-notion-optional]
    ## Privacy and passwords                        [#privacy-and-passwords]
    ## Troubleshooting                              [#troubleshooting]
    ### Desktop app problems                        [#desktop-app-problems]
    ### Extension problems                          [#extension-problems]
    ## Limitations                                  [#limitations]
    ```

*   **New content that is not in today's README** (written exactly as below, then checked during the author's manual check):
    *   **Download and run the installer:**
        1. On the release page, under **Assets**, click `FlowDoc.Setup.<version>.exe` (not "Source code").
        2. Open the downloaded file. If a warning appears, see the next section.
        3. On **Choose Installation Options**, keep **Only for me**. This needs no administrator rights.
        4. On **Choose Install Location**, keep the suggested folder, or pick another, and click **Install**.
        5. On the last page, leave **Run FlowDoc** ticked and click **Finish**.

        (The page names come from the installer type set in `package.json:70–74`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`. Confirm them during the manual check.)
    *   **If your browser or Windows warns you:** "FlowDoc is free and isn't signed with a paid code-signing certificate, so Windows and your browser don't recognize it yet. The source code is public in this repository." Then:
        1. **Microsoft Edge:** the download list says the file "isn't commonly downloaded". Point at the file, click **⋯** → **Keep**, then **Show more** → **Keep anyway**.
        2. **Google Chrome:** the download list may mark the file as unverified or suspicious. Open the menu next to the file and choose the option to keep or download it anyway. Chrome's wording changes between versions; confirm it during the manual check and write the exact words then.
        3. **Windows SmartScreen** ("Windows protected your PC"): click **More info**, then **Run anyway**.
        4. **Smart App Control** (Windows 11 only): if Windows says Smart App Control blocked the app, there is no **Run anyway** button. Don't turn Smart App Control off just for FlowDoc: on Windows 11, once it's off you can't turn it back on without resetting or reinstalling Windows. Use the browser extension instead (see Install the browser extension).

        Author decision, 2026-11-08: the guide does not recommend turning Smart App Control off.
    *   **After you install:**
        * Open FlowDoc from the Start menu. Click **New capture** (or press Alt+Shift+R anywhere), or click **Open a sample guide** to look around first.
        * FlowDoc doesn't update itself. To update, download and run the newer installer; your guides are kept.
        * If you have a GitHub account, click **Watch** → **Custom** → **Releases** on the repository page to get an email when a new version comes out.
    *   **Install the browser extension:**
        1. On the repository page, click **Code** → **Download ZIP**.
        2. Unzip it to a folder you will keep, for example `Documents\FlowDoc`, not your Downloads folder. Chrome loads the extension from this folder every time it starts.
        3. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder inside it (the one that contains `manifest.json`).
    *   **Update the extension:**
        1. Export a backup of your guides first (Export → Backup).
        2. Download the new ZIP and unzip it **over the same folder** you loaded before, replacing the old files.
        3. On `chrome://extensions`, click the reload arrow on the FlowDoc card.

        Don't remove the old FlowDoc card, and don't load a different folder. Chrome treats a different folder as a new, empty extension, and removing the old card deletes its guides. (This is why: `extension/manifest.json` has no `"key"`, so the extension's identity comes from its folder.)
    *   **Run FlowDoc on Linux:** Linux has no download yet; you build it from source (link to `developers.md#build-the-installers` and `developers.md#linux-one-time-setup`). It hasn't been tested on real hardware yet. This section also holds:
        * how to use the AppImage and `.deb` once built, with `<version>` placeholders
        * uninstalling on Linux (`sudo apt remove flowdoc`, or delete the AppImage)
        * the Linux data folders (`~/.config/FlowDoc/` installed, `~/.config/flowdoc/` from source)
    *   **Antivirus row** (in Desktop app problems):

        | Problem | Fix |
        | --- | --- |
        | My antivirus flagged FlowDoc | FlowDoc uses a keyboard hook to record typing during a capture, and some antivirus tools flag keyboard hooks. The hook runs only while a capture is active. Restore the file and add an exception for FlowDoc, or use the browser extension instead. |
*   **Why**: It holds every user-facing section in one place, ordered by task, with the errors found in review corrected.

#### 4. `docs/developers.md` (Create)

*   **Type / Scope**: Developer documentation.
*   **Content sources:** mapping rows 4–5, 10, 13, 14 (building), 15, 35 (`git pull`), 50–55, and the EBUSY and elevate.exe rows from row 25.
*   **Exact outline:**

    ```text
    # FlowDoc for developers
    ## What you need                     [#what-you-need]
    ## Get the code                      [#get-the-code]
    ## Run the desktop app from source   [#run-the-desktop-app-from-source]
    ## Build the installers              [#build-the-installers]
    ## Linux one-time setup              [#linux-one-time-setup]
    ## Load the extension from source    [#load-the-extension-from-source]
    ## Web workspace                     [#web-workspace]
    ## Tests                             [#tests]
    ## How the desktop recorder works    [#how-the-desktop-recorder-works]
    ## How passwords are kept out of guides  [#how-passwords-are-kept-out-of-guides]
    ## Project layout                    [#project-layout]
    ## Build errors                      [#build-errors]
    ```

*   **Version-free file names** (README.md:158–174 contains versioned names):
    *   `FlowDoc Setup <version>.exe` (installer) and `FlowDoc <version>.exe` (portable)
    *   `FlowDoc-<version>.AppImage`, made runnable with `chmod +x FlowDoc-*.AppImage`
    *   `flowdoc_<version>_amd64.deb`, installed with `sudo apt install ./flowdoc_*_amd64.deb`
*   **Why**: It keeps Node.js, Git, npm and build internals out of the user's path while keeping all of that content.

#### 5. `PRIVACY.md` (Modify)

*   **Type / Scope**: Privacy policy (public; also used by the future Chrome Web Store listing).
*   **Rule:** every sentence that is true for only one app says which app. Extension wording is kept word for word, inside an "Extension" part.
*   **Exact changes, line by line against today's file:**

    | Line | Today | Replace with |
    | --- | --- | --- |
    | 3 | Last updated: November 6, 2026 | Last updated: `<date of the commit that changes PRIVACY.md>` |
    | 5 | This policy covers the FlowDoc - Step Recorder browser extension for Chrome and Edge. … | This policy covers both FlowDoc apps: the **desktop app** for Windows and Linux, and the **FlowDoc - Step Recorder browser extension** for Chrome and Edge. FlowDoc is free, open-source software. You can read every line of its code in this repository. Where the two apps differ, this policy says which one it means. |
    | 10 | Your guides stay in your browser, on your computer. | Your guides stay on your computer: in a folder on your disk (desktop app) or in your browser's storage (extension). |
    | 11 | … Then it goes straight from your browser to the provider you chose, using your own key. | … Then it goes straight from your computer to the provider you chose, using your own key: from the desktop app itself, or from your browser for the extension. |
    | 16–20 | "Only while a recording you started is running, FlowDoc records the following in the tab you are recording:" and three bullets | "Only while a recording you started is running, FlowDoc records the following. Nothing is recorded at any other time." Then two parts. **Desktop app:** (1) What you do: clicks, double-clicks and right-clicks, the text you type (unless you turn off "Include typed text in steps" in Settings → Capture), and keys such as Enter and Esc, in the screen area or apps you chose to record. FlowDoc receives these through a system-wide keyboard and mouse hook that runs only during a recording. (2) Where you did it: the name of the app and window, and the name of the button or field, read through Windows UI Automation or the Linux accessibility interface. In a web browser, also the page's address and title, for "Navigate to" steps. (3) A screenshot of the screen, the area or the app window for each step. **Extension:** today's lines 16–20, unchanged ("in the tab you are recording" and its three bullets). |
    | 22 | When you type into a password field, FlowDoc writes "Type your password" and never stores the password itself. | In both apps, when you type into a password field, FlowDoc writes "Type your password" and never stores the password itself. The [user guide](docs/user-guide.md#privacy-and-passwords) explains which password fields FlowDoc can and can't detect. |
    | 24 | FlowDoc records nothing when no recording is running. It also records nothing on browser pages such as `chrome://` … or inside embedded frames. | FlowDoc records nothing when no recording is running. The extension also records nothing on browser pages such as `chrome://` and the Chrome Web Store, or inside embedded frames. |
    | 28–32 | Storage paragraphs (browser storage, AES-GCM, uninstall deletes) | Two parts. **Desktop app:** Your guides and screenshots are stored as files in your guides folder. By default that's `library` inside the app's data folder (`%APPDATA%\FlowDoc` on Windows, `~/.config/FlowDoc` on Linux), and you can choose another folder in Settings → Storage. Settings are stored in `settings.json` in the data folder. Your AI key and Notion secret are encrypted by your operating system (DPAPI on Windows; GNOME Keyring or KWallet on Linux). On Linux without a keyring they're only obfuscated, and Settings shows a warning. Uninstalling the desktop app keeps your guides until you delete the data folder. **Extension:** today's lines 28, 30 and 32, unchanged. |
    | 36 | … data goes straight from your browser to that provider, never through any FlowDoc server. | … data goes straight from your computer to that provider (from the desktop app itself, or from your browser for the extension), never through any FlowDoc server. |
    | 56 | … the file is created in your browser and saved to your computer. … | … the file is created on your computer (by the desktop app, or in your browser for the extension) and saved where you choose. Who you share it with is up to you. |
    | 64 | No code downloaded from the internet. All code ships inside the extension. | No code downloaded from the internet. All code ships inside the app or the extension. |
    | 66 | `## Permissions` | `## Permissions (browser extension)`. Add one sentence above the table: "The desktop app asks for no special permissions. It runs under your normal user account." |

    Lines 9, 12, 38–52, 58–63, 68–85 stay as they are.
*   **Why**: The main download, the desktop app, has no policy today. Widening the scope without these edits would leave browser-only sentences that are false for the desktop app.

#### 6. `CONTRIBUTING.md` (Create)

*   **Type / Scope**: Community file (repo root).
*   **Proposed Changes**: About 30 lines:
    *   open an issue before a large change
    *   fork → branch → pull request
    *   run `npm test` and `npm run test:desktop` before submitting
    *   write docs in plain English
    *   never write the project's old product name in new code or docs (the compatibility code that reads old data stays)
    *   for setup, see `docs/developers.md`
    *   security problems go to SECURITY.md, not public issues
*   **Why**: Gives the repo GitHub's Contributing tab (CUJ 5).

#### 7. `SECURITY.md` (Create)

*   **Type / Scope**: Community file (repo root).
*   **Proposed Changes**: About 20 lines:
    *   **Supported version:** the latest release only.
    *   **What to report:** the AI key or Notion secret leaving the PC other than to the provider the user chose; a password appearing in a guide or export; recording outside a capture; code running from a guide or backup file being opened or imported.
    *   **How to report:** GitHub → **Security** → **Report a vulnerability**, which is private. Don't open a public issue.
    *   **What happens next:** "FlowDoc is maintained by one person. Reports are answered on a best-effort basis, with no fixed timeframe. Confirmed problems are fixed in a new release."
*   **Why**: Gives the repo the Security tab and a private channel. FlowDoc handles secrets and screen content.

#### 8. `README.md` (Modify: full rewrite)

*   **Type / Scope**: Landing page.
*   **Proposed Changes**: Replace all 820 lines with the nine blocks from the Technical Plan, about 120 lines.
*   **Badges:**
    *   release: `https://img.shields.io/github/v/release/avin045/FlowDoc`
    *   license: `https://img.shields.io/github/license/avin045/FlowDoc`
    *   platforms (static): `https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20Chrome%20%7C%20Edge-0078D6`, linked to `#other-ways-to-run-flowdoc`
    *   extension: `https://img.shields.io/badge/Chrome%20%2F%20Edge%20extension-any%20computer-4285F4?logo=googlechrome&logoColor=white`, linked to `docs/user-guide.md#install-the-browser-extension`
    *   Linux: `https://img.shields.io/badge/Linux-build%20from%20source-FCC624?logo=linux&logoColor=black`, linked to `docs/user-guide.md#run-flowdoc-on-linux`
    *   Download: `https://img.shields.io/badge/Download%20for%20Windows-4F46E5?style=for-the-badge`, linked to `https://github.com/avin045/FlowDoc/releases/latest`

    4F46E5 is the light-theme `--accent` in `extension/app/app.css:11`. Checked on 2026-11-08: shields.io no longer has a Windows logo (`logo=windows` draws nothing), so the Download badge has no logo. The Chrome and Linux logos render.
*   **Exact footer** (the end of the file):

    ```markdown
    ## License

    FlowDoc is free and open source under the [Apache License 2.0](LICENSE). Copyright 2026 avin045.

    [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

    FlowDoc is an alternative to tools like Scribe. It is not affiliated with Scribe.
    ```

*   **Why**: The landing page for non-technical Windows users (Goals 1, 2 and 8).

#### 9. `docs/release-notes/v1.1.0.md` (Modify, line 37) and `docs/release-notes/v1.1.1.md` (Modify, line 42)

*   **Type / Scope**: Release notes.
*   **Proposed Changes**: Replace the line with exactly:

    ```markdown
    See the [user guide](https://github.com/avin045/FlowDoc/blob/main/docs/user-guide.md) for how to record, edit and export guides.
    ```

    The link is absolute because the same text is pasted into the published GitHub release description.
*   **Why**: Author decision, 2026-11-08: edit the old notes so readers land on the manual.

#### 10. `docs/designs/readme-landing-page.md` (Create)

*   **Type / Scope**: Design document.
*   **Proposed Changes**: This document, committed in phase 6.
*   **Why**: Keeps the reasoning with the repo.

#### 11. Untracked working files (Delete, after the author confirms)

*   **Files:** `concepts_brief.md`, `design_draft.md`, `implementation_readiness_report.md` (repo root, never committed).
*   **Proposed Changes**: Delete them once this design is committed. They are untracked, so git can't restore them; ask the author before deleting. Everything this design relies on from them is now written in this design.

#### Files deliberately not changed

*   `extension/content.js:82`: a code comment, "(see README)", about password fields. The text it refers to moves to `docs/developers.md` › How passwords are kept out of guides. Changing a comment is still a code-file change, which is out of scope. Recorded for a later code pass.
*   `scripts/dist.mjs:51`: points to a "Build installers in the cloud" section that doesn't exist in README.md. Out of scope; recorded for a later code pass.
*   `package.json` `description`: differs from the new tagline. Out of scope.

#### Changes outside the repository (after merge, each command shown to the author first)

1. `gh repo edit` with the description, homepage, topics and wiki setting from the Technical Plan.
2. `gh api -X PUT repos/avin045/FlowDoc/private-vulnerability-reporting`.
3. For each of `v1.1.0` and `v1.1.1`:
    1. `gh release view <tag> --json body -q .body > <tag>.orig.md`. Keep this file; it is the rollback copy.
    2. Copy it to `<tag>.new.md` and replace only the "See the README" sentence with the exact sentence from item 9.
    3. `gh release edit <tag> --notes-file <tag>.new.md`.

### Verification Plan

*   **Compilation/Build**: Not applicable: no code or build files change. `git diff --stat main...HEAD` must list only `.md` files and `docs/screenshots/*.png`.
*   **Unit Tests**: Not applicable (docs only). `npm test` is not affected.
*   **Link and anchor check**: an uncommitted Node script, run before each phase's checkpoint and once over everything before the pull request. For `README.md`, `docs/user-guide.md`, `docs/developers.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `SECURITY.md` and both release notes, it:
    *   collects Markdown links `[..](..)`, Markdown images `![..](..)`, and HTML `src` and `href` attributes, including inside the README's centered `<div>`;
    *   resolves each relative path against the folder of the file that contains it, and confirms the target file exists;
    *   for links with `#anchor`, builds GitHub-style anchors from the target file's headings and confirms the anchor exists. GitHub's rule: lowercase; remove every character that isn't a letter (including non-English letters), a digit, a space, `-` or `_`; turn spaces into `-`; add `-1`, `-2` to repeated headings.

    It skips `http(s)` URLs and must report zero failures.
*   **Content checks** (each must return no matches):
    *   **Developer terms in the README:**
        * `rg -n -i "node\.js|\bnpm\b|git clone|electron|dpapi|appimage|\bx11\b|mv3" README.md`
        * `rg -n "\bGit\b" README.md` (case-sensitive, so "GitHub" doesn't match)
    *   **Version numbers:** `rg -n "\b\d+\.\d+\.\d+\b" README.md docs/user-guide.md docs/developers.md`. A match is allowed only if it's an IP address or not a version (judge by hand, and record the exception in the PR).
    *   **Old product name:** search every changed file, case-insensitively, for the old name used in the data-migration code at `desktop/main.js:26–40`. This design doesn't write the name out, by project rule.
    *   **No npm in the user guide:** `rg -n "npm" docs/user-guide.md`.
*   **Mapping completeness**: every row of the mapping table is ticked off against the new files. The headings of `docs/user-guide.md` and `docs/developers.md` are compared with the exact outlines in items 3 and 4: same text, same levels, same order.
*   **Privacy facts**: each desktop sentence in `PRIVACY.md` is traced to the code that does it:
    *   the hook starts and stops only during a capture: `desktop/recorder.js:770–788, 812–815`
    *   typed text and the setting that turns it off: `desktop/recorder.js:580–588`
    *   app, window and browser address/title: `desktop/recorder.js:349–351, 414–427, 450–451`
    *   UI Automation and the accessibility interface: `desktop/inspector/windows.ps1`, `desktop/inspector/linux.py`, `desktop/inspector/index.js`
    *   key encryption and the no-keyring case: `desktop/settings.js`
    *   folders: `desktop/main.js:25–67`, `desktop/store.js`
    *   AI and Notion calls: `desktop/ai.js`, `desktop/notion.js`

    **Completeness:** list every field that the `buildStep` calls in `desktop/recorder.js` store (text, value, url, pageTitle, app, window, the screenshot), and confirm that each one is covered by a sentence in "What FlowDoc records".
*   **Rendered review, before merge** (open the pull request branch on github.com in a browser):
    *   **Goal 1:** at 1366×768, the Download badge is visible within the first 450 px of the README box.
    *   **Themes:** check light, dark and dark-dimmed; every badge and image is visible in each.
    *   **Phone width:** at 375 px wide, the page itself doesn't scroll sideways. The "How it works" table may scroll inside itself, and each caption stays readable.
    *   **Images:** all images load, and the three "How it works" crops are readable at desktop width. The Download badge shows the Windows logo; if not, apply the fallback in item 8.
*   **After merge** (on the default branch):
    *   The **Contributing** and **Security** tabs appear above the README. GitHub only shows them for files on the default branch.
    *   The About box shows the new description, the homepage link to `releases/latest`, and the topics.
    *   The edited v1.1.0 and v1.1.1 release pages link to the user guide, and that link opens.
*   **Manual, by the author, on a Windows machine before merge**:
    *   Download the installer through the README in Edge and in Chrome.
    *   Confirm the warning steps and the installer page names in item 3 match what appears on screen.
    *   Write Chrome's exact wording into UG.

    These can't be checked without a real download on Windows.

--------------------------------------------------------------------------------

*Drafted with EGM*
