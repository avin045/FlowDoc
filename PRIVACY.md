# FlowDoc Privacy Policy

Last updated: November 8, 2026

This policy covers both FlowDoc apps: the **desktop app** for Windows and Linux, and the **FlowDoc - Step Recorder browser extension** for Chrome and Edge. FlowDoc is free, open-source software. You can read every line of its code in this repository. Where the two apps differ, this policy says which one it means.

## Summary

- FlowDoc has no account, no server and no analytics.
- Your guides stay on your computer: in a folder on your disk (desktop app) or in your browser's storage (extension).
- Nothing leaves your computer unless you turn on an optional AI or Notion feature. Then it goes straight from your computer to the provider you chose, using your own key: from the desktop app itself, or from your browser for the extension.
- We never sell or share your data, and we never see it.

## What FlowDoc records

Only while a recording you started is running, FlowDoc records the following. Nothing is recorded at any other time.

**Desktop app:**

- **What you do**: clicks, double-clicks and right-clicks, the text you type (unless you turn off "Include typed text in steps" in Settings → Capture), and keys such as Enter and Esc, in the screen area or apps you chose to record. FlowDoc receives these through a system-wide keyboard and mouse hook that runs only during a recording.
- **Where you did it**: the name of the app and window, and the name of the button or field you used, read through Windows UI Automation or the Linux accessibility interface. In a web browser, also the page's address and title, for "Navigate to" steps.
- **A screenshot** of the screen, the area or the app window for each step.

**Extension**, in the tab you are recording:

- **What you do**: clicks, the text you type into fields, choices from dropdowns and checkboxes, keys such as Enter and Esc, and moving to another page or tab.
- **The page you are on**: the page's address and title, and the name of the button or field you used.
- **A screenshot** of the visible tab for each step.

In both apps, when you type into a password field, FlowDoc writes "Type your password" and never stores the password itself. The [user guide](docs/user-guide.md#privacy-and-passwords) explains which password fields FlowDoc can and can't detect.

FlowDoc records nothing when no recording is running. The extension also records nothing on browser pages such as `chrome://` and the Chrome Web Store, or inside embedded frames.

## Where your data is stored

**Desktop app:** Your guides and screenshots are stored as files in your guides folder. By default that's `library` inside the app's data folder (`%APPDATA%\FlowDoc` on Windows, `~/.config/FlowDoc` on Linux), and you can choose another folder in Settings → Storage. Settings are stored in `settings.json` in the data folder. Your AI key and Notion secret are encrypted by your operating system (DPAPI on Windows; GNOME Keyring or KWallet on Linux). On Linux without a keyring they're only obfuscated, and Settings shows a warning. Uninstalling the desktop app keeps your guides until you delete the data folder.

**Extension:** Your guides, screenshots and settings are stored in your browser's local extension storage, on your computer. They are not uploaded anywhere.

If you add an AI key or a Notion secret, FlowDoc encrypts it with AES-GCM before storing it. It uses a key that your browser creates and that no script can read out.

You can delete a guide at any time from the FlowDoc workspace. If you uninstall the extension, everything it stored is deleted too, so export a backup first if you want to keep your guides.

## Optional features that send data

These features are off until you set them up with your own account and key. When you use them, data goes straight from your computer to that provider (from the desktop app itself, or from your browser for the extension), never through any FlowDoc server.

### Improve with AI and Translate

You choose **Google Gemini** (`generativelanguage.googleapis.com`) or **Groq** (`api.groq.com`), and paste your own API key. When you click **Improve with AI** or **Translate**, FlowDoc sends that provider:

- the text of the guide's steps;
- for the Elaborate and Conceptual styles only: a cropped screenshot around each step's action, with any redactions you added in the editor already applied. The Crisp style and Translate send text only.

The provider's own privacy policy and terms apply to that data:

- [Google Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Groq privacy policy](https://groq.com/privacy-policy/)

### Save to Notion

If you add your own Notion integration secret and click **Save to Notion**, FlowDoc sends the guide's text and screenshots to Notion (`api.notion.com`). It creates the page in the workspace you choose. [Notion's privacy policy](https://www.notion.so/notion/Privacy-Policy-3468d120cf614d4c9014c09f6adc9091) applies.

### Export

When you export a guide (PDF, Word, HTML, Markdown or JSON), the file is created on your computer (by the desktop app, or in your browser for the extension) and saved where you choose. Who you share it with is up to you.

## What we don't do

- No analytics, tracking or advertising.
- No selling, renting or sharing of user data with third parties.
- No use of data for anything other than making your guides.
- No use of data to determine creditworthiness or for lending.
- No code downloaded from the internet. All code ships inside the app or the extension.

## Permissions (browser extension)

The desktop app asks for no special permissions. It runs under your normal user account.

| Permission | Why FlowDoc needs it |
| --- | --- |
| `activeTab`, `<all_urls>` | Take a screenshot of each step and run the recorder on the site you choose to record |
| `scripting` | Start the recorder only while you record: in the tab you record, in tabs you switch to, and in pages that load meanwhile. Outside a recording, FlowDoc runs no code in any web page |
| `tabs`, `webNavigation` | Write "Navigate to" steps and follow the recording when you switch tabs |
| `storage`, `unlimitedStorage` | Keep your guides and screenshots on your computer |

## Children

FlowDoc is not directed at children under 13 and does not knowingly collect their data.

## Changes to this policy

If this policy changes, the new version will be published here with a new "Last updated" date.

## Contact

Questions or concerns: open an issue at [github.com/avin045/FlowDoc/issues](https://github.com/avin045/FlowDoc/issues).
