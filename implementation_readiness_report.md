# Implementation Readiness Report: Stage 9, round 1

* **Target:** `docs/designs/readme-landing-page.md`, lines 406–637 ("Detailed Implementation Plan" to end)
* **Date:** 2026-11-08
* **Reviewers:** egm-implementation-readiness (completed), egm-codebase-details (completed), egm-style (completed). Each ran in a fresh context with the reading list: README.md, PRIVACY.md, package.json, both release notes, extension/content.js.
* **Verdict:** Not ready to implement. 1 Blocker, 18 Major, 21 Nit after deduplication.

The main context spot-checked these facts against the repo:
* The Contents block has 11 links to sections on the same page.
* `extension/manifest.json` has no `"key"` field.
* README.md lines 160–174 contain file names with the version `1.1.1` in them.
* PRIVACY.md lines 10, 11 and 32 describe browser-only behavior.

**Confirmed correct by at least two reviewers:**
* The mapping table covers all 57 headings, and its line numbers match README.md.
* These citations are right: v1.1.0.md:37, v1.1.1.md:42, content.js:82, dist.mjs:51.
* 4F46E5 is the light-theme accent (app.css:11).
* The keyboard hook runs only inside a capture (recorder.js:770–788, 812–815).
* Keys are encrypted with Electron safeStorage.
* `perMachine: false`.

---

## 🔴 Blocker

### B1. Widening PRIVACY.md leaves browser-only sentences that become false for the desktop app (codebase-details-1-1)

Raised by codebase-details (Blocker), implementation-readiness (Major) and style. Lines 553–561.

The plan says to "leave all extension facts as they are." Once the policy covers the desktop app, these sentences become wrong for it:
* PRIVACY.md:10: "guides stay in your browser"
* :11 and :36: "goes straight from your browser". On the desktop, those calls run in the app's background process (`desktop/ai.js`, `desktop/notion.js`).
* :16: "the tab you are recording"
* :24: nothing is recorded inside embedded frames. That is extension-only.
* :32: uninstalling deletes everything. Desktop guides survive an uninstall.
* :56: "the file is created in your browser"
* :64: "All code ships inside the extension"

**Fix:** list each sentence with its exact replacement. Or prescribe the structure: every affected section gets "Desktop app" and "Extension" sub-bullets, with exact wording for Summary bullets 2–3 and for the openings of the Optional-features and Export sections.

---

## 🟡 Major

### M1. Link counts are wrong, and 8 link-table rows rewrite links that will no longer exist (codebase-details-1-2)

Lines 474 and 479–502. Also lines 69, 280 and 361, outside the target range.

README.md has 36 `](#` links on 34 lines. The 11 in Contents disappear together with Contents (mapping row 2). That leaves 25 links in the body using 17 distinct anchors. Eight table rows (`#screenshots`, `#2-which-version-should-i-use`, `#3-get-the-code`, `#guide-b-chrome--edge-extension`, `#web-workspace-no-install`, `#for-developers`, `#limitations`, `#license`) have no surviving link.

**Fix:** correct the counts, and mark those 8 rows "No surviving link".

### M2. Link targets are written from the repo root, but most links will sit in files under `docs/` (style-1-1)

Lines 474–504.

For example, a link that moves into `docs/user-guide.md` and is written as `docs/developers.md#…` resolves to `docs/docs/developers.md`. Image paths and links back to root files have the same problem.

**Fix:** add a "Lands in" column and write each target relative to that file (`#anchor`, `developers.md#anchor`, `../README.md#license`). Images inside `docs/user-guide.md` are written as `screenshots/x.png`.

### M3. No single, complete heading outline for the user guide (implementation-readiness-1-1)

Lines 436–462, 486, 498, 500, 523 and 626.

The Technical Plan outline is missing the H3s that the mapping and link tables depend on:
* Title and description
* Edit a step
* Add, move and delete blocks
* Blur, crop or change the highlight
* Hide the side panels
* Where your guides are stored
* Use your own guides folder
* Try the sample guide
* Light and dark mode
* Translate a guide

The storage heading is also spelled two ways ("Where guides are stored" vs "Where your guides are stored"), which means two different anchors.

**Fix:** add one complete H1–H4 outline with the exact heading text to the implementation plan, and use it as the reference for the check at line 626.

### M4. The install-warning advice leaves security choices to the implementer (implementation-readiness-1-2)

Lines 524–530.
* Chrome's prompt has no exact click path.
* Smart App Control has no "Run anyway" button, and on Windows 11 turning it off can't be undone without a reset or reinstall. Whether to tell people to turn it off is the author's call.

**Fix:** write the exact Chrome steps, and write the exact Smart App Control text: what the block looks like, that there is no override, whether turning it off is advised, and the alternatives (the browser extension, or building from source).

### M5. The antivirus row gives the wrong cause and a fix that doesn't work (style-1-2)

Line 532. The hook itself is what antivirus tools react to. Building from source uses the same hook.

**Fix:** "FlowDoc uses a keyboard hook to record typing during a capture, and some antivirus tools flag keyboard hooks. The hook runs only while a capture is active. Restore the file and add an exception, or use the browser extension instead."

### M6. Versioned file names moving into developers.md fail the plan's own version search (implementation-readiness-1-3)

Lines 538 and 623. README.md:160–174 contains `FlowDoc Setup 1.1.1.exe`, `FlowDoc-1.1.1.AppImage`, `flowdoc_1.1.1_amd64.deb` and commands that use them.

**Fix:** use `<version>` placeholders and globs (`chmod +x FlowDoc-*.AppImage`, `sudo apt install ./flowdoc_*_amd64.deb`).

### M7. How to make the three "How it works" crops is not specified (implementation-readiness-1-4)

Lines 514–518. Missing:
* how the app is launched (`_electron.launch` with `FLOWDOC_USER_DATA`)
* the viewport, device scale factor and theme
* the clicks to reach each screen
* a selector for each crop
* the capture mode to show

If "Specific apps" is selected, the dialog lists the real open apps, which breaks the no-real-user-data rule. The three images are also missing from the commit order.

**Fix:** specify all of these, select "Whole screen", and add the crops to the commit order.

### M8. The content searches don't test what Goal 2 promises, and the old-product-name search can't be run (style-1-3)

Lines 622 and 624. The pattern misses "Git" and lowercase variants. The old-name search has no string to search for.

**Fix:** `rg -n -i "node\.js|\bnpm\b|git clone|electron|dpapi|appimage|\bx11\b|mv3" README.md`, plus a case-sensitive `rg -n "\bGit\b" README.md`. For the old name, point to its definition in `desktop/main.js:26–40` without writing it out.

### M9. The desktop privacy facts leave out data the code collects (implementation-readiness-1-5)

Lines 558 and 632. Missing from the list:
* the browser address and page title in "Navigate to" steps (`recorder.js:414–427`)
* typed text, unless it's turned off
* app and window names stored with each step

The trace check also leaves out `desktop/inspector/` and `desktop/main.js`, and can only check sentences that are written, so it can't catch anything missing.

**Fix:** add the three items. Add those files to the trace check. Add a completeness check against the step fields that `recorder.js` builds.

### M10. "Nothing is removed except rows marked Removed" isn't true (style-1-4)

Lines 410 and rows 1, 9, 25, 28 and 36. Those rows drop text silently. The removed row at README.md:426 also contains a tip that still applies: press Alt+Shift+R to stop a stuck capture.

**Fix:** reword the rule to include the corrections in the Notes column, and keep the Alt+Shift+R tip in Troubleshooting.

### M11. The plan cites the brief and then deletes it (style-1-5)

Lines 518 and 603. The brief and the draft are untracked, so git can't restore them once deleted. Deleting them is also an action, so it doesn't belong under "Files deliberately not changed".

**Fix:** cite "Author decision, 2026-11-08" instead of the brief. Move the deletion into the file list as "Delete (untracked, after author confirmation)".

### M12. "Download the new ZIP and reload" can lose extension guides (implementation-readiness-1-6)

Line 448. The manifest has no `"key"`, so an unpacked extension's identity depends on its folder path. A new ZIP unzipped to a different folder loads as a new, empty extension. If the user then removes the old card, Chrome deletes the old guides.

**Fix:** "Export a backup, extract over the same folder, click reload, and never remove the old card." When installing, keep the folder somewhere permanent, not in Downloads.

### M13. The above-the-fold check may be impossible and has no fallback (implementation-readiness-1-7)

Line 628. GitHub puts the README below the repo header and the file list, which gets 2 more entries with this change.

**Fix:** measure on the current repo at 1366×768 before implementing, then set a pass criterion that can actually be met, such as "first thing in the README, visible after one scroll".

### M14. The phone-width check expects tables to stack, which GitHub tables don't do (style-1-6)

Lines 630–631. GitHub renders tables as blocks that scroll sideways inside themselves.

**Fix:** "At 375 px the page itself doesn't scroll sideways. The How it works table may scroll inside itself, and each caption stays readable."

### M15. The Contributing and Security tabs only appear after the merge (style-1-7)

Line 631. GitHub builds those tabs from the default branch.

**Fix:** move this check to the steps after the merge.

### M16. The link checker's coverage isn't defined (codebase-details-1-3)

Lines 615–620.

**Fix:** the checker covers Markdown links, Markdown images and HTML `src`/`href` attributes, each resolved relative to the file that contains it.

### M17. The replacement sentence for the release notes isn't given (codebase-details-1-4)

Line 589.

**Fix:** `See the [user guide](https://github.com/avin045/FlowDoc/blob/main/docs/user-guide.md) for how to record, edit and export guides.`

### M18. The installer walkthrough doesn't say which choices to make (codebase-details-1-5)

Lines 523 and 531. The installer has an "Only for me / All users" page and a folder page. "No admin rights needed" is true only if the user keeps "Only for me" (`package.json:70–74`).

**Fix:** list each installer page and the choice to keep on it.

---

## 🟢 Nit

| ID | Line(s) | Issue | Fix |
| --- | --- | --- | --- |
| style-1-8 | 424, 426, 445, 462 | Rows 11, 13, 32 and 49 quote shortened headings | Quote README.md:136, 140, 497 and 687 exactly |
| style-1-9 | 523 | The list of rows that feed the user guide is incomplete | "rows 3, 4 (version guidance), 6–9, …, 25 (except build-error rows), …" |
| style-1-10 | 550 | "Take the hex from app.css" is redundant | "4F46E5 is the light `--accent`, app.css:11" |
| implementation-readiness-1-8 | 550 | Footer layout undecided | Give the exact footer Markdown |
| style-1-11 | 517, 615, 627, 633 | Session jargon ("scratchpad", "built-in browser", "this session") | Name the tools; say "before merge, on the author's Windows machine" |
| style-1-12 | 517 | "About 200 KB" can't fail | "≤ 200 KB each" |
| style-1-13 | 531 | The Watch → Releases tip needs a GitHub account | "If you have a GitHub account, …" |
| style-1-14 | 623, 625 | Version search too narrow; npm search can't be run as written | `\b\d+\.\d+\.\d+\b`; no `npm` anywhere in user-guide.md |
| style-1-15 | 581, 583, 601 | Three sentences need tightening | Copy the import-file risk to line 274; "best effort, no fixed timeframe"; "doesn't exist in README.md" |
| style-1-16 | 637 | "*Drafted with EGM*" process marker | Delete it or define EGM |
| implementation-readiness-1-9 | 609, 289 | Release edits: no fetch command, no rollback copy | `gh release view vX --json body -q .body > vX.orig.md`, edit a copy, `--notes-file` |
| implementation-readiness-1-10 | 557 | "Last updated" set to a future merge date | Use the commit date, or update it just before the merge |
| implementation-readiness-1-11 | 439 | Linux uninstall and Linux data folders have no home | Put them under UG › Run FlowDoc on Linux, or in DEV |
| implementation-readiness-1-12 | rows 18, 30 | Repeated "Desktop app" / "Extension" sub-headings create `-1` anchors | "Desktop app actions" / "Extension actions", "Desktop app problems" / "Extension problems" |
| implementation-readiness-1-13 | ~550 | `logo=windows` may not render (low confidence) | Confirm it renders; fallback: drop `logo=` |
| implementation-readiness-1-14 | 478–502 | Some rewritten links point to the section they're already in | Rule: delete the link or reword it to "above"/"below" |
| codebase-details-1-6 | 511 | settings-storage.png shows the from-source folder (`flowdoc`), not `FlowDoc` | Note the difference in the caption |
| codebase-details-1-7 | 508 | The screenshot heading uses a glob | List the exact paths |
| codebase-details-1-8 | 617 | The anchor rule drops `_` and Unicode letters | Keep them, as GitHub does |
| codebase-details-1-9 | 613 | `git diff --stat main` uses the wrong base | `git diff --stat main...HEAD` |
| codebase-details-1-10 | 506–609 | File numbering doesn't match the commit order; no checkpoints | Add a phase → files → checkpoint table |

---

## Resolution (2026-11-08)

The author asked for the findings to be fixed. All changes went into `docs/designs/readme-landing-page.md`: the Detailed Implementation Plan was rewritten, and the matching parts of the Goals and Technical Plan were updated.

| Finding | Outcome | Where |
| --- | --- | --- |
| B1 (codebase-details-1-1) | Fixed. A line-by-line replacement table for PRIVACY.md, and a rule that every app-specific sentence names its app. | DIP item 5; Technical Plan › PRIVACY.md |
| M1 (codebase-details-1-2) | Fixed. Counts corrected (36 links on 34 lines; 11 in Contents removed; 25 body links using 17 anchors). The 8 anchors used only in Contents are listed as "no surviving link". | DIP › Link rewrite table; Open Questions; Alternative I |
| M2 (style-1-1) | Fixed. Links are now listed by the line they were on, with "Lands in" and "Write as" columns, plus a path-rules table that covers images. | DIP › Link rewrite table |
| M3 (implementation-readiness-1-1) | Fixed. An exact H1–H4 outline with anchors; one name for the storage heading everywhere. | DIP item 3; Technical Plan |
| M4 (implementation-readiness-1-2) | Fixed. Exact steps for Edge and SmartScreen. Chrome's wording is confirmed during the manual check. Smart App Control: don't turn it off, use the extension (author decision). | DIP item 3 |
| M5 (style-1-2) | Fixed. Reworded the cause; replaced "build from source" with the extension. | DIP item 3 |
| M6 (implementation-readiness-1-3) | Fixed. `<version>` placeholders and globs. | DIP item 4 |
| M7 (implementation-readiness-1-4) | Fixed. Full capture method: launch, environment variable, size, theme, clicks, selectors, "Whole screen" only. Crops added to the phases. | DIP item 2; Rollout |
| M8 (style-1-3) | Fixed. Exact `rg` commands. The old name is located through `desktop/main.js:26–40` without writing it. | Verification Plan |
| M9 (implementation-readiness-1-5) | Fixed. Typed text, app and window names, and browser address and title added. Trace list extended. Completeness check against the step fields. | DIP item 5; Verification Plan |
| M10 (style-1-4) | Fixed. The removal rule names the correction rows. The Alt+Shift+R tip is kept as a "capture seems stuck" row. | DIP › Mapping (rule, row 25) |
| M11 (style-1-5) | Fixed. Citations to the brief replaced with "Author decision, 2026-11-08". Deleting the untracked files is now item 11, after the author confirms. | DIP items 2, 11; Goal 4 |
| M12 (implementation-readiness-1-6) | Fixed. Safe update steps (back up, unzip over the same folder, reload, never remove the card). Install into a permanent folder. | DIP item 3 |
| M13 (implementation-readiness-1-7) | Fixed. Measured: the README box starts at 949 px at 1366×768, signed out. Goal 1 is now "Download badge within the first 450 px of the README box"; the About box homepage link is checked after merge. | Goal 1; Technical Plan; Verification Plan |
| M14 (style-1-6) | Fixed. The page itself doesn't scroll sideways; the table may scroll inside itself. | Verification Plan |
| M15 (style-1-7) | Fixed. The tabs check moved to after merge. | Verification Plan; Rollout |
| M16 (codebase-details-1-3) | Fixed. The checker covers Markdown links, images and HTML `src`/`href`, each relative to the file it's in. | Verification Plan |
| M17 (codebase-details-1-4) | Fixed. Exact sentence given. | DIP item 9 |
| M18 (codebase-details-1-5) | Fixed. Installer pages and the choice to keep on each. Page names confirmed during the manual check. | DIP item 3 |
| style-1-8 | Fixed. Headings quoted exactly. | Mapping rows 11, 13, 32, 49 |
| style-1-9 | Fixed. Exact source-row lists. | DIP items 3, 4 |
| style-1-10 | Fixed. | DIP item 8 |
| implementation-readiness-1-8 | Fixed. Exact footer Markdown. | DIP item 8 |
| style-1-11 | Fixed. Tools named; "this session" and "scratchpad" removed. | DIP item 2; Verification Plan |
| style-1-12 | Fixed. "≤ 200 KB". | DIP item 2 |
| style-1-13 | Fixed. | DIP item 3 |
| style-1-14 | Fixed. A general version pattern; no `npm` anywhere in the user guide. | Verification Plan |
| style-1-15 | Fixed. The import-file risk added in both places; "best effort, no fixed timeframe"; "doesn't exist in README.md". | Technical Plan; DIP items 7, 11 |
| style-1-16 | **Contested.** "*Drafted with EGM*" is the provenance marker the design template requires. It stays. | — |
| implementation-readiness-1-9 | Fixed. Save the original, edit a copy, apply it; rollback from the saved file. | DIP › Changes outside the repository; Rollout |
| implementation-readiness-1-10 | Fixed. The date of the commit that changes PRIVACY.md. | DIP item 5 |
| implementation-readiness-1-11 | Fixed. Linux uninstall and Linux data folders go under UG › Run FlowDoc on Linux. | Mapping rows 14, 23, 26; DIP item 3 |
| implementation-readiness-1-12 | Fixed. "Desktop app actions" / "Extension actions" and "Desktop app problems" / "Extension problems". | DIP item 3 |
| implementation-readiness-1-13 | Fixed. Checked in the rendered review, with a fallback that drops the logo. | DIP item 8 |
| implementation-readiness-1-14 | Fixed. The self-link rule is applied to each affected line. | DIP › Link rewrite table |
| codebase-details-1-6 | Fixed. A caption note about the from-source folder. | DIP item 1 |
| codebase-details-1-7 | Fixed. Exact paths listed. | DIP item 1 |
| codebase-details-1-8 | Fixed. The full GitHub anchor rule. | Verification Plan; Technical Plan |
| codebase-details-1-9 | Fixed. `git diff --stat main...HEAD`. | Verification Plan |
| codebase-details-1-10 | Fixed. A phases-and-checkpoints table; file items follow the phase order. | DIP › Phases and checkpoints |

Still open (outside what the design can settle):
* Chrome's exact warning wording.
* The installer page names.
* Whether the About box shows above the fold.

All three are confirmed on a real Windows machine or after the merge, as the Verification Plan says.
