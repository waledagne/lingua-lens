# Lingua Lens

A TypeScript Chrome extension for continuous **Polish → English** translation on Windows. Allegro is the initial automatic site; other websites can be translated from the toolbar button or enabled individually.

## Load the first version

The built extension is already in `dist/`.

1. Open `chrome://extensions` in **Google Chrome 138 or newer**.
2. Turn on **Developer mode**, choose **Load unpacked**, and select `C:\Users\Rog\Desktop\projects\lingua-lens\dist`.
3. Pin **Lingua Lens**, open its toolbar popup, and choose **Set up local translation**. You can also open the extension's **Options** page.
4. On the setup tab, click **Download & enable translation** (or **Enable & test translation**). Keep that tab open until the example translation appears.
5. Refresh Allegro. Lingua Lens translates its text and watches for newly added dialogs, menus, notifications, and product content.
6. Use **Pause & restore Polish** to restore original text. **Always translate this site** controls automatic translation on future visits.

Chrome performs the first language-pack download. Availability depends on Chrome, its policies, your device, and the requested pair; setup reports failures instead of silently sending text to a server. No cloud fallback or API key is configured.

Avoid enabling Chrome's built-in page translation or another page translator at the same time: both extensions would be modifying the same text.

## Development

Node.js 20.18+ and npm are sufficient. Runtime code has **no third-party dependencies**.

```powershell
cd C:\Users\Rog\Desktop\projects\lingua-lens
npm ci
npm run check
npm run dev
```

`dev` rebuilds TypeScript. Reload the extension from `chrome://extensions` and refresh the website after each change. Changes in `public/` require restarting the build/watch command.

```powershell
npx playwright install chromium
npm run test:browser
```

Browser tests launch a separate temporary profile and a test copy of the extension. Only that copy gets a deterministic fake Translator; **production `dist/` always calls the real Chrome API**. These tests verify the extension's routing, offscreen engine, worker, iframe support, dynamic DOM updates, restoration, and popup controls, not real translation quality. Unit tests exercise races and protected input handling. `LINGUA_LENS_BROWSER` can specify another Chrome for Testing executable when the downloaded default cannot launch.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/dom-translator.ts` | Observe changes, discover open shadow roots, queue text, preserve originals, reject stale responses |
| `src/content.ts` | One controller per permitted document/frame; message bridge |
| `src/background.ts` | Tab state, settings, optional site access, script registration, engine lifecycle |
| `src/engine.ts` | One local Translator session, sequential work queue, in-memory translation cache |
| `src/segment-worker.ts` | Split long descriptions into sentence-sized chunks in a worker |
| `src/popup.ts` / `public/popup.html` | Translate, pause, restore, remember site, and display status |
| `src/setup.ts` / `public/setup.html` | User-initiated language-pack download and a real translation check |

The local Translator API requires a document context, so it runs in an offscreen document, not the extension service worker. Its real sentence segmentation worker is the reason for the `offscreen` permission's `WORKERS` use. Initial Translator creation happens from a click in the visible setup document, on the extension's origin; the offscreen engine then uses that same origin's activated language pair.

Translation replaces text-node data and selected display attributes (`title`, `aria-label`, `placeholder`, `alt`), never `innerHTML`. This preserves element identities and click listeners. Form values, passwords, textareas, editable regions, code, and `translate="no"` regions are excluded. Options without explicit values are excluded because their labels can determine submitted values. New dialogs are prioritized over the initial backlog. Responses apply only when the node still contains the original source and translation is still enabled. Restoring originals preserves subsequent website changes.

## Access and privacy

- Required site access is limited to `allegro.pl` and its subdomains. Manual translation on other websites uses the temporary `activeTab` grant.
- Enabling **Always translate this site** elsewhere requests access to that hostname and registers its content script persistently. Disable the switch to remove the automatic registration; Chrome's site-access settings can revoke the granted permission.
- Translatable webpage text is passed only between extension components and Chrome's local engine. The extension includes no network translation requests, analytics, API keys, or remote scripts.
- Preferences are saved in extension-local storage. Tab overrides use session storage; translated text is held only in a bounded in-memory cache.
- Site access means all relevant text can be read, including hidden page UI. Do not enable automatic translation on sites where you do not want this behavior.

## Current limits and next work

- This is a first prototype; real Allegro translation quality and all its flows still need testing in the user's Chrome.
- Chrome UI, the Web Store, protected browser pages, and Chrome's PDF viewer are outside normal extension access.
- Images, canvas-drawn text, CSS-generated text, closed shadow roots, and native browser dialogs need other approaches (for example, an OCR feature).
- Cross-origin frames require permission for their own origin. Allegro frames are covered by the declared host access; third-party payment or delivery widgets may require additional work.
- Open shadow roots inserted with a host are detected immediately. Roots attached later to existing hosts are discovered on interaction or within 2.5 seconds.
- Each DOM text node is translated independently; sentences split by inline markup can lose context. Nodes above 12,000 characters are currently skipped. Short brands and mixed-language text can produce imperfect results.
- The popup counts the main frame's text items, not aggregated iframe totals. Pausing is a per-tab override until navigation; turn off the site switch to disable future automatic translation.
- Websites that continuously rewrite their own UI can cause flicker or conflict with translated labels. Frameworks can depend on exact text-node content; test actual purchase flows before treating them as verified.
- Next priorities: real Allegro modal coverage, grouped inline-text translation, a glossary for shopping terms, and optional OCR/cloud providers if needed.

## API references

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Extension content scripts and frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
