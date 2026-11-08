# FlowDoc README landing page and docs restructure

* **Author:** avin045
* **Date:** 2026-11-08

## Overview

FlowDoc's README is about 820 lines long. It opens with prerequisites (Node.js and Git) and build-from-source steps before any download. That suits developers, but the target reader is a stranger, and usually a non-technical Windows user, who should be able to see what FlowDoc does and install it within the first screen.

The plan has three parts:

1. Replace the README with a short, centered landing page:
   - logo, name and a one-line tagline
   - a few badges
   - a privacy note
   - one hero image
   - a single **Download for Windows** button with install steps
   - a features table
2. Move the manual into `docs/`.
3. Add basic community files, and update the GitHub description and topics.

The scope is documentation and repo settings only. It does not include application code, a GIF, a GitHub Pages site, publishing Linux or portable builds, code signing, or the Chrome Web Store.

What a reader gets: a visitor knows what FlowDoc does and how to install it in one screen. They are warned in advance about the Windows security prompts that would otherwise stop them, and they can find the full manual one click away.

## Analysis

Seven independent reviewers looked at the plan: design, accuracy against the code, scope, readability for a newcomer, implementation readiness, document structure, and trade-offs the plan accepts without question. Every lens agreed with the direction: download first, manual in `docs/`, no Node.js or Git on the landing page. The problems are in the details. The main context checked the important claims against the repo.

### Must fix before writing anything

1. **"Nothing uploaded, everything local" is false as stated.** FlowDoc can send data out when the user turns that on. The optional AI features call Gemini or Groq, and the Elaborate and Conceptual styles send screenshots. Save to Notion uploads screenshots too. The privacy note has to keep the qualifier the current README already uses. Proposed wording: *"No FlowDoc account, no FlowDoc server, no analytics. Your guides stay on your PC. Data leaves only if you turn on the optional AI (your own Gemini or Groq key) or Save to Notion."*

2. **(Resolved 2026-11-08: all screenshots were re-taken from the current desktop app with a throwaway data folder, under the same file names. New files were added: `library.png`, `settings-capture.png`, `settings-storage.png`, `settings-integrations.png`. `settings-1.png` is now the General tab and `settings-2.png` the AI tab, so their README captions need rewriting.)** **The screenshots show an older version of the app.** `guide-editor.png` and `export.png` show a "Copy text" button. The current app labels it "Copy" and opens a menu (verified in `extension/app/main.js`). `settings-1.png` and `settings-2.png` show the single-page Settings from before 1.1.1 and the "system keychain" wording that was removed on purpose. These need to be re-taken from v1.1.1 before any of them become the hero image. `new-capture.png` and `home-light.png` look current.

3. **No stable direct-download link is possible today.** The installer's file name includes the version (`FlowDoc.Setup.1.1.1.exe`) because `package.json` sets no `artifactName`. A direct link would serve the old file or break at the next release. Under today's constraints, the button points to `https://github.com/avin045/FlowDoc/releases/latest`, with one line under it: *"Under **Assets**, click `FlowDoc.Setup.<version>.exe`, not 'Source code'."* No version number is written in the README or docs; the version appears only through a dynamic release badge. A true one-click download needs a one-line build config change (`build.nsis.artifactName: "FlowDoc-Setup.exe"`). That is outside "docs only" and is listed as a decision below.

4. **Splitting the manual will break links unless it follows a plan.** About 25–35 internal links cross the planned page boundaries (for example, B5 and B6 link to A5 and A6, and A4 links to C4). GitHub doesn't report a missing anchor; the page just opens at the top. Several sections had no planned home: Screenshots, "Which version should I use?", "Get the code", Web workspace, privacy while recording, storage and your own guides folder, uninstall, how passwords are kept out of guides, project layout, and License. The fix:
   - a table mapping every old heading to its new file and heading
   - a check that every old heading lands exactly once
   - one link-check run (`npx lychee` or a manual click-through of the rendered branch) before merging

### The landing page

- **Order:** centered header (logo, H1, tagline, one badge row) → Download (button, requirements line, short install note) → hero image → privacy note → how it works → features → other ways to run FlowDoc → documentation → contributing, license and disclaimer. The Download button must be visible on the first screen, below GitHub's file list.
- **Markup limits:**
  - GitHub alerts (`> [!NOTE]`) don't render inside `<div align="center">`. Close the centered block before the first alert, and use only one alert (privacy).
  - GitHub strips CSS, so the button has to be an image: a shields.io `for-the-badge` badge or a committed SVG.
  - Badges: release version (dynamic), license, and a static "Windows 10 / 11" platform badge. No download-count badge (the release has about 3 downloads), no CI badge (there is no CI), and no "featured" badges.
- **The requirements line under the button:** *Windows 10 (2004+) or 11 · 64-bit · free, Apache-2.0 · Mac: not available · Linux: build from source.*
- **The install warnings:** an unsigned, rarely downloaded installer can hit up to three:
  1. The browser's own download warning (Edge: "isn't commonly downloaded" → ⋯ → Keep → Show more → Keep anyway).
  2. SmartScreen: "Windows protected your PC" → More info → Run anyway.
  3. On Windows 11 with Smart App Control on, a hard block with no "Run anyway" button.

  The landing page gets two or three lines and a link. The full numbered steps live in exactly one docs section, because the walkthrough already exists in four copies. Add one sentence on why the warnings appear: *FlowDoc is free and doesn't pay for a code-signing certificate; the source is public.* Use a calm `[!NOTE]` tone, not `[!WARNING]`. Test the steps on clean Windows 10 and 11 machines rather than writing them from memory.
- **After you install:** 3–4 short lines.
  - Keep the installer defaults; no admin rights are needed.
  - Open FlowDoc → New capture (Alt+Shift+R), or try the sample guide first.
  - FlowDoc doesn't update itself. Run the newer installer; your guides are kept. Use Watch → Custom → Releases to hear about new versions.
  - Uninstall from Windows Settings → Apps.
- **Tagline:** plain words, no jargon. Draft: *"Do a task on your PC once. FlowDoc writes the how-to guide for you, with screenshots."* Then: *works in any Windows app: File Explorer, Excel, Settings, your browser.* Use the same sentence as the GitHub repo description. Developer terms (Electron, DPAPI, AppImage, X11, MV3) stay in `docs/`.
- **Features table:** list the features that need no setup first: record, edit, blur, export, and themes. There are exactly five export formats: PDF, Word, HTML, Markdown and Backup (JSON). Print and Copy are sharing actions, not formats. Label AI, Translate and Notion as optional, with what each needs. Notion is available in both the desktop app and the extension; today's README wrongly says desktop only.
- **Hero vs. "how it works":** the same screenshot shouldn't appear in both. The `new-capture.png` and `export.png` shots are full windows dimmed behind a dialog, and at about 270 px per column the text can't be read. Crop each frame to its dialog, and repeat the captions as plain text.
- **Hero image build:** a small Playwright script renders the real (re-taken) editor screenshot inside a window frame on a branded background. Rules for it:
  - It lives in `scripts/`, never under `desktop/`, `extension/` or `demo/`, which go into the installer.
  - It doesn't import `scripts/icons.mjs`, which rewrites the logo and icons when it runs.
  - It reads `extension/icons/logo.svg` from disk.
  - It writes to `docs/images/` and keeps raw captures in `docs/screenshots/`.
  - It crops out the scrollbar, renders at 2× scale, and stays under about 500 KB.
  - It uses one background that works in both GitHub light and dark themes, rather than a light/dark image pair to maintain.
  - Rendering at 1280×640 gives a repo social preview image as well.
- **Scribe:** remove the bare "in the style of Scribe (scribehow.com)" link. Say "an alternative to tools like Scribe" once, add a one-line "not affiliated with Scribe" note in the footer (not inside the privacy note), and make no claims about competitors' pricing or features.
- **Antivirus trust:** FlowDoc records keystrokes and the screen, so antivirus tools can flag it as a keylogger. Add one line: *records only after you press New capture; a recorder bar stays visible; passwords are never saved.* Add a troubleshooting entry for "My antivirus flagged FlowDoc".

### Other ways to run FlowDoc

- **Chrome extension:** it does **not** need Node.js. `extension/vendor/` is committed to git (verified), so a user can Download ZIP → unzip → `chrome://extensions` → Developer mode → Load unpacked. The current README wrongly says to run `npm install` first. Warn that uninstalling the extension deletes its guides, so export a backup first. Don't link the Web Store until the listing is live.
- **Linux:** build from source only. Say it has not been tested on real hardware yet.
- Don't mention the portable `.exe` or the Linux packages anywhere users will see them; neither has been published.

### Privacy policy scope

`PRIVACY.md` covers only the browser extension, but the landing page's main download is the desktop app. Either widen it to cover both apps, or label the link "(browser extension)" and point the privacy note at a docs section that covers both. Keep `PRIVACY.md` in the root either way, because the Web Store listing will need it there.

### Links that point into the README from elsewhere

- The v1.1.0 and v1.1.1 release notes link to `#readme` "for how to record, edit and export guides". After the rewrite, that page needs a visible "Full manual → docs/" link near the top.
- `extension/content.js:82` has a code comment, "(see README)", about password fields. Keep that text in a docs page so the comment still points somewhere real.
- `scripts/dist.mjs:51` points to a README section "Build installers in the cloud" that doesn't exist, and to a CI workflow that doesn't exist either. Don't write that section to match; record it as a known broken reference for a later code fix.

### Repo settings and community files

- **Topics:** drop `self-hosted`. FlowDoc has no server, so the topic would mislead people. Suggested: `scribe-alternative`, `step-recorder`, `how-to-guide`, `screenshot`, `sop`, `documentation`, `local-first`, `offline`, `privacy`, `windows`, `electron`, `chrome-extension`.
- **Other settings:**
  - Description: the tagline. The old value, "Step by Step Guide Creator", is kept here in case you want to change it back.
  - Homepage URL: `/releases/latest`.
  - Turn off the empty wiki.
  - Optionally upload a 1280×640 social preview.

  Put the exact `gh repo edit` command in the PR description, because settings changes don't show in a diff.
- **CONTRIBUTING.md:** short.
  - Open an issue first.
  - Run `npm test` and `npm run test:desktop`.
  - Follow the project naming rule.
  - Link to the developers docs instead of copying their commands.
- **CODE_OF_CONDUCT.md:** Contributor Covenant 2.1. It needs a real contact for reports, not a placeholder.
- **SECURITY.md:** five of seven reviewers rated this above a code of conduct. FlowDoc stores API keys and a Notion secret, captures the screen, and just had a security-hardening release. A short SECURITY.md plus GitHub's private vulnerability reporting is cheap to add.
- **Copyright:** use "avin045" in new files. `package.json` says the author is "FlowDoc"; that mismatch is noted and left out of scope.

### Clean-up while moving the manual

- Drop the troubleshooting rows about bugs fixed in earlier versions and the dated "October 2026" model note.
- Move the build-error rows (EBUSY, elevate.exe) to the developers page.
- Replace the manual "Contents" list with `docs/README.md`, which GitHub shows when someone opens the folder. It holds the reading order and the desktop-vs-extension comparison table.
- Give each page one H1, no skipped heading levels, and no emoji in headings.
- Make sure the old product name doesn't appear in any new doc. Today it appears only in data-migration code and tests, which stay as they are.

### Inventive options (not required)

- **FlowDoc documents its own install.** Record "Install FlowDoc on Windows" with FlowDoc, from a dev build (`npm run desktop`) so the installer doesn't close the recorder. Export it to Markdown under `docs/guides/install-on-windows/` and caption it *"This guide was made with FlowDoc."* The step that scares people becomes the demo. Rule: never hand-edit an exported guide; re-record or edit it in FlowDoc and export again.
- **One command regenerates every image.** A script starts the web workspace, opens the sample guide with a frozen clock, captures the editor, export and library screens, and builds the hero and social preview images under fixed file names. Cost: it breaks when the UI changes, it can't capture desktop-only screens, and every run adds binary changes to git.
- **The end state to aim for:** a new release needs no README edits. The version shows only through the badge, the button points at `releases/latest`, and images come from one command.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * A landing-page README for non-technical Windows users, with Download visible on the first screen.
  * Accurate claims: a privacy note with its qualifier, exact feature list, honest platform support.
  * Install help that covers the browser download warning, SmartScreen and Smart App Control, kept in one place.
  * The manual moved into `docs/` with no content lost and no broken links, plus a `docs/README.md` index.
  * Current screenshots (re-taken from v1.1.1) and one hero image.
  * CONTRIBUTING.md, plus CODE_OF_CONDUCT.md and/or SECURITY.md.
  * GitHub description, topics, homepage URL, wiki off, optional social preview.
* **Out-of-Scope Non-Goals:**
  * Any application code change (decision 1 below asks whether a one-line build-config change counts).
  * Animated GIF.
  * GitHub Pages site.
  * Publishing Linux AppImage/.deb or the portable `.exe` to releases.
  * Code signing (later candidates: SignPath Foundation's free plan for open-source projects).
  * Chrome Web Store listing.
  * CI, linting, issue templates.
  * Fixing `scripts/dist.mjs`'s reference to a missing README section and CI workflow (logged as a follow-up).

## Alternatives Weighed

* **Animated GIF at the top:** rejected by author: the existing screenshots are enough. A GIF can replace the hero image later without changing anything else.
* **A GIF from Tenor:** rejected by author after review. It wouldn't show FlowDoc, and Tenor's license covers sharing inside chat apps, not copying into an Apache-2.0 repository.
* **GitHub Pages site:** deferred by author. If it comes back, the stronger version hosts the web editor with its sample guide as a "try it in your browser" demo, not a copy of the README.
* **Three equal download buttons (Windows / Linux / extension):** rejected by author. Linux and the extension need technical setup today, so equal buttons would send most clicks to installs non-technical users can't finish.
* **Download-count badge and "featured" badges:** rejected by author. About 3 downloads would hurt credibility, and FlowDoc hasn't earned any featured badges yet.
* **The `self-hosted` topic:** rejected in review. FlowDoc has no server.
* **Direct `/releases/latest/download/<file>` link:** not possible without the `artifactName` build change; see decision 1.
* **The privacy note as originally worded ("nothing uploaded"):** rejected in review because it's inaccurate.
* **The 8-page task-based docs split:** rejected by author: too many pages for the goal of keeping the docs minimal. Replaced with two files (user guide + developers).
* **Splitting docs by app (desktop vs. extension):** objected to in review, because the AI and Notion instructions would stay duplicated across both pages. Splitting by task, or into a single user guide, avoids that.
* **A light/dark pair of hero images:** objected to in review because it doubles the upkeep. One image on a background that works in both themes is enough.

## Key Decisions & Staging for Next Steps

**Settled:**

* Audience: strangers and non-technical Windows users. The main action is downloading and installing the Windows build.
* No GIF. The hero is a framed or cropped image built from a current screenshot.
* Base branch: `main` (PR #1, the security hardening, is merged as `5b53ab4`).
* Download button → `releases/latest`, with a line naming the right file. No version numbers in prose.
* Privacy wording keeps the "only if you turn on AI or Notion" qualifier.
* Screenshots are re-taken from v1.1.1 before being reused.
* The extension's install path is documented without Node.js.
* `self-hosted` is dropped from topics.
* **Docs layout: the small version (decided by author: "keep all info minimal").** Two files: `docs/user-guide.md` (install, desktop app, extension, editing and exporting, troubleshooting, limitations) and `docs/developers.md` (build from source, tests, how the recorder works, project layout, build errors). No `docs/README.md` index, since two links in the README are enough. Sections move mostly as they are, so most internal links only need the file name added in front. The 8-page split is rejected for now; a page gets split out later only if it becomes hard to use.
* **Hero image: `docs/screenshots/home-light.png` (decided by author).** It's current, so it doesn't need re-taking. Shortcoming: it shows the library/home screen, not a finished guide, so it shows less of what FlowDoc produces. A re-taken `guide-editor.png` can replace it later without other changes. With this choice, the outdated screenshots (`guide-editor`, `export`, `settings-1/2`) are not used on the landing page; whether they stay in the user guide is in the open decisions.

* **No build-config change this round (decided by author).** The Download button opens `releases/latest` and names the file to click. Version-free file names (below) stay as a follow-up.
* **Keep all content (decided by author).** Every section moves to the docs files. Rewrite it in plain words and fix the problems this review found; delete nothing except the stale rows already listed.
* **Screenshots are re-taken from the current app under the same file names (decided by author)**, so every link in the README and docs keeps working. If the author re-takes one later, they overwrite the file with the same name.

**Open decisions for the author:**

1. (Deferred) Allow a build-config change in `package.json` that gives every release file a version-free name? Each target gets its own name, so adding Linux later doesn't conflict (each target accepts its own `artifactName`; checked against the installed electron-builder schema):
   * `nsis.artifactName: "${productName}-Setup.${ext}"` → `FlowDoc-Setup.exe`
   * `portable.artifactName: "${productName}-Portable.${ext}"` → `FlowDoc-Portable.exe`
   * `appImage.artifactName: "${productName}-${arch}.${ext}"` → `FlowDoc-x86_64.AppImage`
   * `deb.artifactName: "${name}_${arch}.${ext}"` → `flowdoc_amd64.deb`

   Each file then has a permanent `releases/latest/download/<name>` link. The README gets a direct Windows link now, and a Linux link added the same way once those files are published. Check the real file names on the first build that uses this. If it isn't allowed, the button opens the release page.
2. Does "minimal" also mean cutting content from the user guide (for example, the full lists of what is recorded for each action, the step-by-step Linux setup), or only fewer pages with the same content?
3. Headings: keep the A1–C11 numbering word for word (link fixes become mechanical), or drop the numbers (cleaner, and nothing renumbers when a section is added).
4. Outdated screenshots inside the user guide: re-take them later, or remove them from the guide now so it doesn't show the old UI?
5. Community files: CODE_OF_CONDUCT (needs a real contact), SECURITY.md, or both.
6. Edit the published v1.1.0 and v1.1.1 release notes so their README links point to the new docs, or leave them?
7. `PRIVACY.md`: widen it to cover the desktop app, or label the link as extension-only?
8. Main button: a shields.io badge (no upkeep, smaller) or a committed SVG button (larger, one more file)?

**Suggested rollout:**

1. One branch off `main`, with commits in this order: docs pages (content moved) → images → community files → README replacement → optional release-note link fixes.
2. Preview the branch in GitHub's rendered view and check:
   - Light, Dark and Dark-dimmed themes, and phone width
   - the heading diff shows nothing lost
   - all links resolve
   - no old product name
   - no promised Linux or portable download
   - the Contributing and Code of conduct tabs appear
3. Squash-merge, then apply the repo settings.
