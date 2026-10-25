# Lingua Lens

A translation extension that keeps up with the web as it changes. Lingua Lens aims to help you read websites in your preferred language, including text that appears after the page loads: dialogs, menus, notifications, and dynamically loaded content.

The project starts with **Chrome on Windows**, using **TypeScript** and Chrome's local translation engine. Its direction is support for multiple languages and websites, with language preferences and translation controls that work across sites.

## Project direction

- **Your choice of languages:** choose source and target languages, subject to the translation engine's supported language pairs.
- **Use across websites:** translate the current website on demand and remember which sites should translate automatically.
- **Continuous translation:** handle the initial page and newly added or changed text without requiring a full-page refresh.
- **Control over the original:** pause translation, restore source text, and preserve text you are editing.
- **Local translation first:** use on-device translation where available, with any future external provider offered as an explicit option.

Source-language detection and additional translation providers remain future work. The current implementation is described below.

## Current prototype

Choose source and target languages in the toolbar popup or setup page, then click **Apply languages**. Preferences apply to all translated tabs. Polish → English is the initial selection; either language can be changed. Source-language detection is not implemented, so choose the language of the page explicitly.

Use the toolbar on any ordinary HTTP(S) website that Chrome permits extensions to access. No website is enabled automatically by default, and there are no website-specific translation rules or required host permissions. **Always translate this site** requests access to the chosen hostname and enables automatic translation there.

The code currently includes:

- Page text and display-attribute translation, plus observation of newly inserted or updated content.
- Dialog and menu handling through the same DOM observer, rather than site-specific translation rules.
- Open shadow-root discovery and content scripts in frames where site access permits them.
- Per-tab pause and restoration, per-site automatic translation, and local language-pack setup.
- Queued translation, duplicate-text caching, and checks that prevent late responses from overwriting newer page content.
- Saved language choices, preparation status for each language pair, translator sessions and caches separated by pair, and sentence segmentation using the selected source language.

Applying a different pair restores original page text before translating with that pair. A previously prepared pair can resume immediately; a new pair requires setup first. Translation responses for the old pair are ignored after switching.

## Load the first version

The built extension is already in `dist/`.

1. Open `chrome://extensions` in **Google Chrome 138 or newer**.
2. Turn on **Developer mode**, choose **Load unpacked**, and select the project's `dist/` folder.
3. Pin **Lingua Lens** and open its toolbar popup. Choose **From** and **To**, then click **Apply languages**.
4. If the pair needs setup, click **Prepare [source → target]**, or open **Languages & setup**. The setup page also provides the language selectors.
5. On the setup tab, click **Download & enable translation** (or **Enable & test translation**). Keep that tab open until the example translation appears. Unavailable pairs show an error; choose another pair if Chrome cannot provide the requested one.
6. Return to a website in your selected source language and choose **Translate this page** from the toolbar. Try opening a dialog or menu to check newly added content.
7. Use **Always translate this site** to enable translation on future visits. Chrome will request access to that hostname when needed.
8. Use **Pause & restore original** to restore source text. Pausing lasts until navigation; disable the site switch to stop future automatic translation.

After updating an existing unpacked installation, reload the extension in `chrome://extensions` and refresh any pages that were already translated. Previous language-pack setup is retained for its original pair. Previously saved sites are retained only where Chrome still grants the required site access.

Chrome performs the first language-pack download. Availability depends on Chrome, its policies, your device, and the requested pair; setup reports failures instead of silently sending text to a server. No cloud fallback or API key is configured.

Avoid enabling Chrome's built-in page translation or another page translator at the same time: both extensions would be modifying the same text.

## Development

Node.js 20.18+ and npm are sufficient. Runtime code has **no third-party dependencies**. Run these commands from the repository root:

```powershell
npm ci
npm run check
npm run dev
```

`dev` rebuilds TypeScript. Reload the extension from `chrome://extensions` and refresh the website after each change. Changes in `public/` require restarting the build/watch command.

```powershell
npx playwright install chromium
npm run test:browser
```

Browser tests launch a separate temporary profile and a test copy of the extension. Only that copy gets a deterministic fake Translator; **production `dist/` always calls the real Chrome API**. The browser suite is designed to verify the extension's routing, offscreen engine, worker, iframe support, dynamic DOM updates, restoration, and popup controls, not real translation quality. Unit tests exercise races and protected input handling. `LINGUA_LENS_BROWSER` can specify another Chrome for Testing executable when the downloaded default cannot launch.

The latest completed checks passed TypeScript validation, the production build, and all 30 automated unit/integration tests. These include the actual popup, setup, and content scripts in a DOM environment, settings migration, per-site registration, pair-specific readiness and caching, and stale-response protection. Chrome API and Translator behavior in those tests is mocked. The full browser suite remains blocked before launch by a Windows side-by-side configuration error; real translation quality and live website flows remain to be verified.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/dom-translator.ts` | Observe changes, discover open shadow roots, queue text, preserve originals, reject stale responses |
| `src/content.ts` | One controller per permitted document/frame; message bridge |
| `src/background.ts` | Tab state, settings, optional site access, script registration, engine lifecycle |
| `src/engine.ts` | Offscreen messaging and the sentence-segmentation worker |
| `src/translation-engine.ts` | Sequential queue, per-pair translation caches, and a bounded pool of Translator sessions |
| `src/segment-worker.ts` | Split long text into sentence-sized chunks in a worker |
| `src/languages.ts` | Language options, pair validation, names, and sample text |
| `src/settings.ts` | Stored-preference validation, migration, and pair-specific readiness |
| `src/shared.ts` | Shared messages, settings types, and website-access helpers |
| `src/language-controls.ts` | Shared language selectors and swap control |
| `src/popup.ts` / `public/popup.html` | Translate, pause, restore, remember site, and display status |
| `src/setup.ts` / `public/setup.html` | User-initiated language-pack download and a real translation check |

The local Translator API requires a document context, so it runs in an offscreen document, not the extension service worker. Its real sentence segmentation worker is the reason for the `offscreen` permission's `WORKERS` use. Initial Translator creation happens from a click in the visible setup document, on the extension's origin; the offscreen engine then uses that same origin's activated language pair.

The DOM translation controller provides common page handling across websites. Each translation request carries a snapshot of its source and target languages. The background rejects outdated pairs, and the content controller restores source text and invalidates pending responses when the selected pair changes.

Translation replaces text-node data and selected display attributes (`title`, `aria-label`, `placeholder`, `alt`), never `innerHTML`. This preserves element identities and click listeners. Form values, passwords, textareas, editable regions, code, and `translate="no"` regions are excluded. Options without explicit values are excluded because their labels can determine submitted values. New dialogs are prioritized over the initial backlog. Responses apply only when the node still contains the original source and translation is still enabled. Restoring originals preserves subsequent website changes.

## Access and privacy

- Manual translation uses Chrome's temporary `activeTab` grant when you invoke the toolbar extension. There is no required access to any website at installation.
- Enabling **Always translate this site** requests optional access to that exact hostname for HTTP and HTTPS and registers its content script persistently. Subdomains are separate sites.
- Disable the site switch to stop automatic translation and remove its registration. Chrome's site-access settings can revoke the granted permission; revoked sites are removed from automatic translation.
- Translatable webpage text is passed only between extension components and Chrome's local engine. The extension includes no network translation requests, analytics, API keys, or remote scripts.
- Preferences are saved in extension-local storage. Tab overrides use session storage; translated text is held only in a bounded in-memory cache.
- Site access means all relevant text can be read, including hidden page UI. Do not enable automatic translation on sites where you do not want this behavior.

## Current limits

- The language menu reflects Chrome's documented language list. Availability is checked for the selected pair on the device; listed languages do not guarantee every pair is available in every Chrome installation.
- Language preferences are global. There is no source-language detection or per-site language-pair override yet. Mixed-language pages may need a different source selection.
- This is a prototype; translation quality and interactive flows across real websites still need testing in Chrome.
- Chrome UI, the Web Store, protected browser pages, and Chrome's PDF viewer are outside normal extension access.
- Images, canvas-drawn text, CSS-generated text, closed shadow roots, and native browser dialogs need other approaches (for example, an OCR feature).
- Cross-origin frames require permission for their own origin. Permission for the main website does not automatically cover third-party widgets or embedded applications.
- Open shadow roots inserted with a host are detected immediately. Roots attached later to existing hosts are discovered on interaction or within 2.5 seconds.
- Each DOM text node is translated independently; sentences split by inline markup can lose context. Nodes above 12,000 characters are currently skipped. Short brands and mixed-language text can produce imperfect results.
- The popup counts the main frame's text items, not aggregated iframe totals. Pausing is a per-tab override until navigation; turn off the site switch to disable future automatic translation.
- Websites that continuously rewrite their own UI can cause flicker or conflict with translated labels. Frameworks can depend on exact text-node content; test interactive flows before treating them as verified.

## Roadmap

1. **Source-language detection:** detect the page language and improve handling of mixed-language content.
2. **Per-site language preferences:** optionally remember different source and target pairs for individual sites.
3. **Broader website validation:** test dialogs, navigation, forms, embedded frames, and dynamically updated content across different websites and web applications.
4. **Translation quality:** group text split by inline markup and add optional user glossaries for names and recurring terms.
5. **Additional capabilities:** evaluate OCR for image/canvas text and optional external translation providers where the local engine does not meet the user's needs.

## API references

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Extension content scripts and frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
