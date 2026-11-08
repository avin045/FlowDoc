# FlowDoc README landing page and docs restructure

*   **Author:** avin045
*   **Status:** Draft
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

Proposed solution: a landing-page README that a non-technical visitor can act on in its first screen, and a two-file manual in `docs/` that keeps every section and has the errors fixed.

## Goals

*   **Download visible on the first screen.** On GitHub's desktop view at 1366×768, the "Download for Windows" button sits above the fold, below GitHub's file list. Check it by opening the rendered branch in a browser window of that size.
*   **No developer setup on the landing page.** `README.md` doesn't mention Node.js, Git, `npm`, `git clone`, Electron, DPAPI, AppImage, X11 or MV3. Check with a search of the file.
*   **Install help that covers every warning.** The steps cover all three warnings an unsigned installer can trigger:
    *   the browser's download warning
    *   SmartScreen
    *   Smart App Control

    They are written in one place (`docs/user-guide.md`), and the README links to them with two or three lines of its own.
*   **No content lost.** Every H2/H3 heading in today's README has a row in the mapping table (Detailed Implementation) that names its new file and heading, or gives the reason it was removed. The only content allowed to be removed is the stale rows listed in the brief.
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

*   **Plain headings, no numbering.** Each section in the moved manual gets a short plain-English heading. All 34 links that jump to a heading are rewritten and checked.
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

The README is rebuilt from scratch, in this order. The first four blocks have to fit above the fold at 1366×768 (Goal 1).

1. **Centered header** (one `<div align="center">` block, closed right after the quick links):
   *   the logo, `extension/icons/logo.svg`, at 96 px
   *   `# FlowDoc`
   *   the tagline: *"Do a task on your PC once. FlowDoc writes the how-to guide for you, with screenshots."*
   *   one badge row: latest release (dynamic, `img.shields.io/github/v/release/avin045/FlowDoc`), license (`img.shields.io/github/license/avin045/FlowDoc`), and a static "Windows 10 | 11" platform badge
   *   the Download button: a shields.io `for-the-badge` badge reading "Download for Windows", with the Windows logo, linking to `https://github.com/avin045/FlowDoc/releases/latest`
   *   one quick-link row: Download · User guide · Privacy · Developers

   Inside the `<div>`, Markdown needs a blank line before and after it, and GitHub alerts don't render there. That is why the alert comes after the div.
2. **Download details** (plain text, left-aligned, directly below the header):
   *   one line naming the file: *"On the release page, under **Assets**, click `FlowDoc.Setup.<version>.exe`, not 'Source code'."*
   *   one requirements line: *Windows 10 (version 2004 or newer) or 11 · 64-bit · free and open source (Apache-2.0) · Mac: not available · Linux: build from source*
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

One H1, then H2s in the order a user needs them, with H3s below them and no skipped levels. Headings are plain English, unique within the file, and contain no numbers, emoji or symbols, so GitHub's anchors stay readable and stable.

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
| `settings-storage.png` | Where guides are stored |
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
*   **Data folders:** installed and from-source runs use different folders (`%APPDATA%\FlowDoc` vs `%APPDATA%\flowdoc`). Mentioned in "Where guides are stored".
*   **Removed:** troubleshooting rows about bugs fixed in earlier versions, and the dated "October 2026" model note. The build-error rows move to developers.md.
*   **Scribe:** the "in the style of Scribe (scribehow.com)" link is removed; the README footer carries the comparison and the "not affiliated" line.
*   **Old product name:** none written in any changed file.

### PRIVACY.md: one policy for both apps

The structure stays the same (Summary, What FlowDoc records, Where your data is stored, Optional features that send data, Export, What we don't do, Permissions, Children, Changes, Contact). The opening line changes from "the browser extension" to "the FlowDoc desktop app for Windows and Linux and the FlowDoc browser extension for Chrome and Edge", and "Last updated" changes. The extension's facts don't change, so its future Web Store listing still describes the extension correctly. The added desktop facts:

*   **What FlowDoc records:** a global keyboard and mouse hook while a capture runs, screenshots of the screen, an area or chosen apps, and the window and element names read through Windows UI Automation or the Linux accessibility interface. Nothing is recorded outside a capture.
*   **Where data is stored:** the guides folder on disk (default, or one the user picks), and settings in the app's data folder. Keys and the Notion secret are encrypted by the operating system (DPAPI on Windows, GNOME Keyring or KWallet on Linux), or only obfuscated when Linux has no keyring.
*   **Permissions:** an extension-only section. The desktop app needs no special permission beyond a normal Windows user account.

Every desktop fact in the policy is checked against the code before merge (`desktop/main.js`, `desktop/recorder.js`, `desktop/settings.js`, `desktop/store.js`).

### CONTRIBUTING.md and SECURITY.md

*   **`CONTRIBUTING.md`** (root, about 30 lines): open an issue before a large change; run `npm test` and `npm run test:desktop`; keep docs in plain English; never write the project's old product name in new code or docs; the full setup is in `docs/developers.md`. GitHub shows it as the "Contributing" tab.
*   **`SECURITY.md`** (root, about 20 lines): what counts as a security problem (for example, a key or secret leaving the PC unexpectedly, a password appearing in a guide, recording outside a capture); report it privately through GitHub (Security → Report a vulnerability); don't open a public issue; which version is supported (the latest release only). GitHub shows it as the "Security" tab. Turning on private vulnerability reporting is a repo setting (see below).

### Links and anchors

*   All links between files are relative (`docs/user-guide.md#save-guides-to-notion`, `../PRIVACY.md`). The only absolute URLs are the Releases page and the badge images.
*   GitHub builds each anchor from its heading: lowercase, spaces turned into `-`, punctuation dropped. Because the headings are unique and have no symbols, each anchor is predictable.
*   The 34 old in-page links are rewritten to their new file and anchor using the mapping table in the Detailed Implementation.
*   Check: one run of a Markdown link checker over all changed `.md` files, then a click-through of every link that jumps between files on the rendered branch. GitHub doesn't report a missing anchor, so a link checker run that verifies anchors is required, not optional.

### Repository settings and published releases

These changes live on GitHub, not in the diff. They run **after** the pull request is merged, because the links they set point at files that exist only on `main` after the merge.

*   `gh repo edit avin045/FlowDoc --description "<tagline>" --homepage https://github.com/avin045/FlowDoc/releases/latest --enable-wiki=false --add-topic scribe-alternative,step-recorder,how-to-guide,screenshot,sop,documentation,local-first,offline,privacy,windows,electron,chrome-extension`. The value to restore if needed: description "Step by Step Guide Creator", no homepage, no topics, wiki on.
*   Turn on private vulnerability reporting (`gh api -X PUT repos/avin045/FlowDoc/private-vulnerability-reporting`).
*   Edit the published v1.1.0 and v1.1.1 release descriptions: replace the "See the README" sentence with a link to `docs/user-guide.md`, and leave the rest of the text unchanged (`gh release edit vX --notes-file <edited file>`).
*   Optional, by hand in the GitHub web interface: upload a social preview image (1280×640). Not required by any goal.

Each of these changes something public, so each command is shown to the author and run only after their OK.

### Rollout

1. Create a branch `docs/landing-page` from `main`. The 11 screenshots already in the working tree become its first commit.
2. Commit order: user guide and developers pages (content moved and reworded) → `PRIVACY.md` → `CONTRIBUTING.md` and `SECURITY.md` → new `README.md` → release-note link fixes.
3. Open a pull request. Check the rendered branch:
   *   GitHub light, dark and dark-dimmed themes, and phone width
   *   link check
   *   heading mapping complete
   *   the Goal 2 search of `README.md`
   *   no old product name
4. Squash-merge, then apply the repository settings and release-description edits.
5. Rollback: revert the merge commit, and restore the old repository settings with the values above.

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
*   **Reason for Rejection**: Rejected by author: plain headings, with all 34 links rewritten and checked.

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

### Mapping of every current heading

Every heading in today's `README.md` (57 including the title) and where its content goes. "UG" is `docs/user-guide.md`, "DEV" is `docs/developers.md`. Text moves and is reworded in plain English. Nothing is removed except the rows marked **Removed**.

| # | Current heading (line) | New location | Notes |
| --- | --- | --- | --- |
| 1 | `# FlowDoc` and intro (1–5) | README header, tagline, privacy note | "in the style of Scribe (scribehow.com)" removed; the comparison moves to the README footer |
| 2 | Contents (7) | **Removed** | GitHub's outline menu replaces it |
| 3 | Screenshots (22) | README hero (`home-light.png`); other images placed per the Technical Plan table | The captions are rewritten for the new Settings tabs |
| 4 | 1. Before you start: what you need (50) | DEV › What you need; UG › Which version should I use? | Node.js and Git go only to DEV |
| 5 | Required (54) | DEV › What you need | |
| 6 | For the desktop app (77) | UG › Which version should I use? | Requirements list |
| 7 | For the browser extension (83) | UG › Which version should I use? | |
| 8 | Optional (87) | UG › Improve and translate with AI; UG › Save guides to Notion | Split into a "What you need" line in each |
| 9 | 2. Which version should I use? (96) | UG › Which version should I use? | The table row "Install: Run from source, or build an installer" becomes "Download the installer" |
| 10 | 3. Get the code (116) | DEV › Get the code | |
| 11 | Guide A: Desktop app (136) | Dissolved | Its subsections move as listed below |
| 12 | A1. Install (138) | UG › Install the desktop app on Windows | Rewritten around the Releases download |
| 13 | Option 1: Run it from the source code (140) | DEV › Run the desktop app from source | |
| 14 | Option 2: Build and install it like a normal program (150) | DEV › Build the installers; UG › Download and run the installer | How to use the installer goes to UG; how to build it goes to DEV |
| 15 | Linux: one-time setup (176) | DEV › Linux one-time setup | UG › Run FlowDoc on Linux links here |
| 16 | A2. Record your first guide (194) | UG › Record with the desktop app | |
| 17 | Record only an area or only some apps (217) | UG › Record only an area or only some apps | |
| 18 | A3. What the desktop app writes for each action (238) | UG › What FlowDoc writes for each action ("Desktop app" part) | |
| 19 | A4. Privacy while recording (260) | UG › Privacy and passwords | |
| 20 | A5. Optional: AI write-ups with Gemini or Groq (268) | UG › Improve and translate with AI | The "October 2026" model note is **Removed** |
| 21 | A6. Optional: Save guides to Notion (324) | UG › Save guides to Notion | |
| 22 | A7. Capture settings (363) | UG › Capture settings | |
| 23 | A8. Where your guides are stored (375) | UG › Manage your guides › Where your guides are stored | Keeps the installed vs from-source folder table |
| 24 | Use your own guides folder (389) | UG › Manage your guides › Use your own guides folder | |
| 25 | A9. Troubleshooting (desktop) (407) | UG › Troubleshooting | Three "Fixed in this version" rows **Removed**. The EBUSY and elevate.exe rows move to DEV › Build errors. The SmartScreen row links to "If your browser or Windows warns you". An antivirus row is added. |
| 26 | A10. Uninstall (431) | UG › Uninstall the desktop app | |
| 27 | Guide B: Chrome / Edge extension (440) | Dissolved | |
| 28 | B1. Install the extension (444) | UG › Install the browser extension | Rewritten: Download ZIP → unzip → Developer mode → Load unpacked → select the `extension` folder. No `npm install`. |
| 29 | B2. Record your first guide (456) | UG › Record with the extension | |
| 30 | B3. What the extension writes for each action (472) | UG › What FlowDoc writes for each action ("Extension" part) | |
| 31 | B4. Find your guides again (491) | UG › Manage your guides | |
| 32 | B5. Optional: AI in the extension (497) | UG › Improve and translate with AI | Merged; differences go in a Desktop/Extension table |
| 33 | B6. Optional: Save to Notion from the extension (507) | UG › Save guides to Notion | Merged |
| 34 | B7. Change the keyboard shortcut (517) | UG › Change the keyboard shortcut | |
| 35 | B8. Update the extension after pulling new code (521) | UG › Update the extension; DEV › Load the extension from source | UG: download the new ZIP and reload. DEV: `git pull` and reload. |
| 36 | B9. Troubleshooting (extension) (527) | UG › Troubleshooting | The "Load unpacked … missing files" row is rewritten: you selected the wrong folder; pick the one containing `manifest.json` |
| 37 | B10. Uninstall (537) | UG › Uninstall the extension | Keeps "export backups first" |
| 38 | Guide C: Editing and exporting a guide (543) | UG › Edit a guide (intro sentence) | |
| 39 | C1. Title and description (547) | UG › Edit a guide › Title and description | |
| 40 | C2. Edit a step (552) | UG › Edit a guide › Edit a step | |
| 41 | C3. Add, move and delete blocks (558) | UG › Edit a guide › Add, move and delete blocks | |
| 42 | C4. Blur private information, crop, or change the highlight (572) | UG › Edit a guide › Blur, crop or change the highlight | |
| 43 | C5. Export (599) | UG › Export and share a guide | Exactly five formats; Copy and Print described as sharing actions |
| 44 | C6. Try it without recording (627) | UG › Manage your guides › Try the sample guide | |
| 45 | C7. Light and dark mode (631) | UG › Manage your guides › Light and dark mode | |
| 46 | C8. Manage your library (640) | UG › Manage your guides | |
| 47 | C9. Add more steps later (Continue capturing) (648) | UG › Add more steps later | |
| 48 | C10. Translate a guide (660) | UG › Improve and translate with AI › Translate a guide | |
| 49 | C11. More room for the guide (687) | UG › Edit a guide › Hide the side panels | |
| 50 | Web workspace (no install) (695) | DEV › Web workspace | |
| 51 | For developers (705) | DEV (whole file) | |
| 52 | Tests (707) | DEV › Tests | |
| 53 | How the desktop recorder works (735) | DEV › How the desktop recorder works | |
| 54 | How passwords are kept out of guides (744) | DEV › How passwords are kept out of guides | A plain-English summary of the limits ("password fields FlowDoc can't detect") also goes in UG › Privacy and passwords |
| 55 | Project layout (759) | DEV › Project layout | |
| 56 | Limitations (799) | UG › Limitations | |
| 57 | License (816) | README footer | |

### Link rewrite table

The 25 distinct in-page anchors used by the 34 current links, and what they become. A link inside the same new file uses the bare `#anchor`; a link to the other file uses the file path.

| Old anchor | New target |
| --- | --- |
| `#guide-c-editing-and-exporting-a-guide` | `docs/user-guide.md#edit-a-guide` |
| `#b5-optional-ai-improve-and-translate-in-the-extension` | `docs/user-guide.md#improve-and-translate-with-ai-optional` |
| `#a5-optional-ai-write-ups-with-gemini-or-groq` | `docs/user-guide.md#improve-and-translate-with-ai-optional` |
| `#a6-optional-save-guides-to-notion` | `docs/user-guide.md#save-guides-to-notion-optional` |
| `#b6-optional-save-to-notion-from-the-extension` | `docs/user-guide.md#save-guides-to-notion-optional` |
| `#linux-one-time-setup` | `docs/developers.md#linux-one-time-setup` |
| `#guide-a-desktop-app-windows-and-linux` | `docs/user-guide.md#install-the-desktop-app-on-windows` |
| `#guide-b-chrome--edge-extension` | `docs/user-guide.md#install-the-browser-extension` |
| `#c4-blur-private-information-crop-or-change-the-highlight` | `docs/user-guide.md#blur-crop-or-change-the-highlight` |
| `#a7-capture-settings` | `docs/user-guide.md#capture-settings` |
| `#1-before-you-start-what-you-need` | `docs/developers.md#what-you-need` |
| `#web-workspace-no-install` | `docs/developers.md#web-workspace` |
| `#screenshots` | Link removed (the section no longer exists) |
| `#record-only-an-area-or-only-some-apps` | `docs/user-guide.md#record-only-an-area-or-only-some-apps` |
| `#limitations` | `docs/user-guide.md#limitations` |
| `#license` | `README.md#license` (footer heading `## License`) |
| `#how-passwords-are-kept-out-of-guides` | `docs/developers.md#how-passwords-are-kept-out-of-guides` |
| `#for-developers` | `docs/developers.md` |
| `#c8-manage-your-library` | `docs/user-guide.md#manage-your-guides` |
| `#c5-export` | `docs/user-guide.md#export-and-share-a-guide` |
| `#c10-translate-a-guide` | `docs/user-guide.md#translate-a-guide` |
| `#b7-change-the-keyboard-shortcut` | `docs/user-guide.md#change-the-keyboard-shortcut` |
| `#a8-where-your-guides-are-stored` | `docs/user-guide.md#where-your-guides-are-stored` |
| `#3-get-the-code` | `docs/developers.md#get-the-code` |
| `#2-which-version-should-i-use` | `docs/user-guide.md#which-version-should-i-use` |

Links from `docs/` back to root files use `../` (for example `../PRIVACY.md`). Links between `docs/user-guide.md` and `docs/developers.md` use the bare file name.

### Target Files to Create/Modify

#### 1. `docs/screenshots/*.png` (7 Modify, 4 Create; already in the working tree)

*   **Type / Scope**: Images.
*   **Proposed Changes**: `home-light`, `home-dark`, `new-capture`, `guide-editor`, `export`, `settings-1` (now the General tab) and `settings-2` (now the AI tab) are replaced. `library`, `settings-capture`, `settings-storage` and `settings-integrations` are new. All were captured on 2026-11-08 from the current desktop app with a throwaway data folder.
*   **Why**: The old editor, export and Settings shots showed UI from before v1.1.1 ("Copy text", single-page Settings, "system keychain" wording). This is the branch's first commit.

#### 1a. `docs/screenshots/how-capture.png`, `how-edit.png`, `how-export.png` (Create)

*   **Type / Scope**: Images for the README "How it works" row.
*   **Proposed Changes**: Three tight crops, made with Playwright element screenshots during a run of the desktop app with a throwaway data folder: the "Start a capture" dialog, the editor's guide card (title, step 1 and its screenshot), and the "Export guide" dialog. Each is no wider than 1200 px and no larger than about 200 KB. The capture script lives in the session scratchpad, not in the repo.
*   **Why**: The author chose screenshots for "How it works" (reconciliation with the brief, 2026-11-08). The full-window shots are dimmed behind dialogs and unreadable at README column width, so crops are needed.

#### 2. `docs/user-guide.md` (Create)

*   **Type / Scope**: User documentation.
*   **Proposed Changes**: The full user manual, with the H1/H2/H3 outline from the Technical Plan and the content from mapping rows 6–9, 12, 14 (installer usage), 16–49 and 54 (summary), plus 56. New content not in today's README:
    *   **If your browser or Windows warns you:** numbered steps for:
        *   Edge's "isn't commonly downloaded" prompt: ⋯ → Keep → Show more → Keep anyway
        *   Chrome's equivalent prompt
        *   SmartScreen: More info → Run anyway
        *   a note that Smart App Control on Windows 11 may block the installer with no "Run anyway" button, and what that means

        One sentence explains why: no paid code-signing certificate, public source.
    *   **After you install:** keep the installer defaults (no admin rights needed); open FlowDoc from the Start menu; New capture or Alt+Shift+R, or the sample guide first. FlowDoc doesn't update itself: run the newer installer, and your guides are kept. Watch → Custom → Releases sends a notice when there's a new version.
    *   **Antivirus troubleshooting row:** "My antivirus flagged FlowDoc". FlowDoc records keystrokes only during a capture, so some antivirus tools treat its keyboard hook as suspicious. Restore the file and allow it, or build from source.
*   **Why**: It holds every user-facing section in one place, ordered by task, with the errors found in review corrected.

#### 3. `docs/developers.md` (Create)

*   **Type / Scope**: Developer documentation.
*   **Proposed Changes**: The outline from the Technical Plan, with content from mapping rows 4–5, 10, 13, 14 (building), 15, 35 (git pull), 50–55, and the two build-error rows from row 25.
*   **Why**: It keeps Node.js, Git, npm and build internals out of the user path while keeping all of it.

#### 4. `README.md` (Modify: full rewrite)

*   **Type / Scope**: Landing page.
*   **Proposed Changes**: Replace all 820 lines with the nine blocks from the Technical Plan, about 120 lines. Exact badge sources:
    *   release: `https://img.shields.io/github/v/release/avin045/FlowDoc`
    *   license: `https://img.shields.io/github/license/avin045/FlowDoc`
    *   platform (static): `https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6`
    *   Download: `https://img.shields.io/badge/Download%20for%20Windows-4F46E5?style=for-the-badge&logo=windows&logoColor=white`, linked to `https://github.com/avin045/FlowDoc/releases/latest`

    The badge color matches FlowDoc's purple; take the exact hex from `extension/app/app.css` when implementing. The footer has a `## License` heading so the old `#license` anchor keeps working.
*   **Why**: The landing page for non-technical Windows users (Goals 1, 2, 8).

#### 5. `PRIVACY.md` (Modify)

*   **Type / Scope**: Privacy policy.
*   **Proposed Changes**:
    *   Change the scope sentence to cover both apps, and update "Last updated" to the merge date.
    *   Add the desktop facts from the Technical Plan to "What FlowDoc records" and "Where your data is stored".
    *   Mark "Permissions" as applying to the extension.
    *   Leave all extension facts as they are.
*   **Why**: The main download, the desktop app, currently has no policy.

#### 6. `CONTRIBUTING.md` (Create)

*   **Type / Scope**: Community file (root).
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

*   **Type / Scope**: Community file (root).
*   **Proposed Changes**: About 20 lines:
    *   supported version: the latest release only
    *   what to report: keys or the Notion secret leaving the PC unexpectedly, a password appearing in a guide or export, recording outside a capture, or code running from a guide or import file
    *   how to report: GitHub → Security → Report a vulnerability (private); no public issues
    *   what happens next: acknowledgement and a fix in a new release
*   **Why**: Gives the repo the Security tab and a private channel. FlowDoc handles secrets and screen content.

#### 8. `docs/release-notes/v1.1.0.md` (Modify, line 37) and `docs/release-notes/v1.1.1.md` (Modify, line 42)

*   **Type / Scope**: Release notes.
*   **Proposed Changes**: Replace "See the [README](https://github.com/avin045/FlowDoc#readme) for how to record, edit and export guides." with the same sentence linking to `https://github.com/avin045/FlowDoc/blob/main/docs/user-guide.md`. The link is absolute because the same text is pasted into the GitHub release description.
*   **Why**: The author decided to edit the old notes, so readers land on the manual.

#### 9. `docs/designs/readme-landing-page.md` (Create)

*   **Type / Scope**: Design document.
*   **Proposed Changes**: The finalized version of this draft.
*   **Why**: Keeps the reasoning with the repo.

#### Files deliberately not changed

*   `extension/content.js:82`: a code comment, "(see README)", about password fields. The text it refers to moves to `docs/developers.md` › How passwords are kept out of guides. Changing a comment is still a code-file change, which is out of scope. Recorded for a later code pass.
*   `scripts/dist.mjs:51`: points to a README section, "Build installers in the cloud", that has never existed. Out of scope; recorded for a later code pass.
*   `package.json` `description`: differs from the new tagline. Out of scope.
*   `concepts_brief.md` and `design_draft.md` (repo root, untracked): never committed. Deleted from the working tree once the design is saved to `docs/designs/`.

#### Changes outside the repository (after merge, each shown to the author first)

*   `gh repo edit` with the description, homepage, topics and wiki setting from the Technical Plan.
*   `gh api -X PUT repos/avin045/FlowDoc/private-vulnerability-reporting`.
*   `gh release edit v1.1.0` and `gh release edit v1.1.1`: fetch each current description, replace only the "See the README" sentence, and upload it with `--notes-file`.

### Verification Plan

*   **Compilation/Build**: Not applicable: no code or build files change. `git diff --stat main` must list only `.md` files and `docs/screenshots/*.png`.
*   **Unit Tests**: Not applicable (docs only). `npm test` is not affected.
*   **Static Analysis & Linting**: Link and anchor check, using a Node script kept outside the repo in the session scratchpad. For every relative link in `README.md`, `docs/*.md`, `PRIVACY.md`, `CONTRIBUTING.md` and `SECURITY.md`, it:
    *   confirms the target file exists
    *   builds GitHub-style anchors from the target file's headings (lowercase; drop punctuation other than spaces and `-`; spaces become `-`; repeated headings get `-1`, `-2`)
    *   confirms the anchor exists

    It must report zero failures. It skips external URLs.
*   **Content checks** (searches that must return nothing):
    *   **Developer terms in the README:** `README.md` for `Node|npm|git clone|Electron|DPAPI|AppImage|X11|MV3`.
    *   **Version numbers:** `README.md`, `docs/user-guide.md` and `docs/developers.md` for `1\.1\.[0-9]` and `Setup 1|Setup\.1`.
    *   **Old product name:** every changed file, searched for the old product name.
    *   **Wrong extension instruction:** `docs/user-guide.md` for `npm install` inside the extension section.
*   **Mapping completeness**: Every row of the mapping table is checked off against the new files by heading. The H2/H3 headings of the new files are compared with the outline in the Technical Plan.
*   **Rendered review**: Open the pull request branch on GitHub in the built-in browser:
    *   **Above the fold:** at 1366×768, the Download badge is visible without scrolling (Goal 1).
    *   **Themes:** check light, dark and dark-dimmed.
    *   **Phone width:** at 375 px wide, no horizontal scroll in the README.
    *   **Images:** confirm that all images load, that the three "How it works" crops are readable at desktop width and stack sensibly at phone width, and that the Contributing and Security tabs appear.
*   **Privacy facts**: Each desktop sentence in `PRIVACY.md` is traced to the code that does it (`desktop/recorder.js` hook start/stop, `desktop/settings.js` key encryption, `desktop/store.js` folders).
*   **Manual, by the author**: Download the installer through the README on a Windows machine and confirm the warning steps match what Edge, Chrome and SmartScreen actually show. The steps are written from those programs' current behavior and can't be fully verified from this session.

--------------------------------------------------------------------------------

*Drafted with EGM*
