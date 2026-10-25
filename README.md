# Lingua Lens

A translation extension that keeps up with the web as it changes. Lingua Lens aims to help you read websites in your preferred language, including text that appears after the page loads: dialogs, menus, notifications, and dynamically loaded content.

The project starts with **Chrome on Windows**, using **TypeScript** and Chrome's local translation engine. Its direction is support for multiple languages and websites, with language preferences and translation controls that work across sites.

## Project direction

- **Your choice of languages:** choose a target language and select or detect the source language, subject to the translation engine's supported language pairs.
- **Use across websites:** translate the current website on demand and remember which sites should translate automatically.
- **Continuous translation:** handle the initial page and newly added or changed text without requiring a full-page refresh.
- **Control over the original:** pause translation, restore source text, and preserve text you are editing.
- **Local translation first:** use on-device translation where available, with any future external provider offered as an explicit option.

These describe the intended product. The prototype's current scope is listed below.

## Current prototype

The first implementation uses a fixed **Polish → English** language pair. Language selection and automatic source-language detection are not implemented yet.

Allegro was the first example used to shape the prototype, and it is currently the only site enabled automatically by default. You can also invoke translation on other ordinary websites through the toolbar or enable automatic translation for an individual hostname. Translation on those sites still uses the same fixed language pair.

The code currently includes:

- Page text and display-attribute translation, plus observation of newly inserted or updated content.
- Dialog and menu handling through the same DOM observer, rather than site-specific translation rules.
- Open shadow-root discovery and content scripts in frames where site access permits them.
- Per-tab pause and restoration, per-site automatic translation, and local language-pack setup.
- Queued translation, duplicate-text caching, and checks that prevent late responses from overwriting newer page content.

Some setup text, controls, and permission defaults still reflect the initial Polish/Allegro prototype. Generalizing those is part of the next implementation work; the broader project direction does not imply those changes have already shipped.

## Load the first version

The built extension is already in `dist/`.

1. Open `chrome://extensions` in **Google Chrome 138 or newer**.
2. Turn on **Developer mode**, choose **Load unpacked**, and select the project's `dist/` folder.
3. Pin **Lingua Lens**, open its toolbar popup, and choose **Set up local translation**. You can also open the extension's **Options** page.
4. On the setup tab, click **Download & enable translation** (or **Enable & test translation**). Keep that tab open until the example translation appears.
5. Open a website, then use the toolbar popup's **Translate this page** button. The current prototype expects Polish text and translates it into English. Try opening a dialog or menu to check newly added content.
6. Use **Always translate this site** to enable translation on future visits. On sites that need additional access, Chrome will ask for that site's permission. Allegro is already enabled by default; refresh an existing Allegro tab after setup.
7. Use the pause button to restore original text. In the current UI, this button is labeled **Pause & restore Polish**.

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

The latest completed checks passed TypeScript validation, the production build, and all 10 DOM/unit tests. Full browser tests were blocked before launch by a Windows side-by-side configuration error. Real translation quality and live website flows remain to be verified.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/dom-translator.ts` | Observe changes, discover open shadow roots, queue text, preserve originals, reject stale responses |
| `src/content.ts` | One controller per permitted document/frame; message bridge |
| `src/background.ts` | Tab state, settings, optional site access, script registration, engine lifecycle |
| `src/engine.ts` | One local Translator session, sequential work queue, in-memory translation cache |
| `src/segment-worker.ts` | Split long text into sentence-sized chunks in a worker |
| `src/shared.ts` | Shared messages, settings types, and the prototype's fixed language pair and default site |
| `src/popup.ts` / `public/popup.html` | Translate, pause, restore, remember site, and display status |
| `src/setup.ts` / `public/setup.html` | User-initiated language-pack download and a real translation check |

The local Translator API requires a document context, so it runs in an offscreen document, not the extension service worker. Its real sentence segmentation worker is the reason for the `offscreen` permission's `WORKERS` use. Initial Translator creation happens from a click in the visible setup document, on the extension's origin; the offscreen engine then uses that same origin's activated language pair.

The DOM translation controller provides the common page-handling behavior. Current language configuration, sentence segmentation, and default-site handling still include Polish/Allegro assumptions that need to be removed as language support expands.

Translation replaces text-node data and selected display attributes (`title`, `aria-label`, `placeholder`, `alt`), never `innerHTML`. This preserves element identities and click listeners. Form values, passwords, textareas, editable regions, code, and `translate="no"` regions are excluded. Options without explicit values are excluded because their labels can determine submitted values. New dialogs are prioritized over the initial backlog. Responses apply only when the node still contains the original source and translation is still enabled. Restoring originals preserves subsequent website changes.

## Access and privacy

- Manual translation on other websites uses the temporary `activeTab` grant. Enabling **Always translate this site** requests access to that hostname and registers its content script persistently.
- The prototype also declares required access to `allegro.pl` and its subdomains. This is an initial default to replace with user-selected site access as the extension becomes more general.
- Disable the site switch to stop automatic translation. For user-added sites, this also removes the automatic registration; Chrome's site-access settings can revoke the granted permission.
- Translatable webpage text is passed only between extension components and Chrome's local engine. The extension includes no network translation requests, analytics, API keys, or remote scripts.
- Preferences are saved in extension-local storage. Tab overrides use session storage; translated text is held only in a bounded in-memory cache.
- Site access means all relevant text can be read, including hidden page UI. Do not enable automatic translation on sites where you do not want this behavior.

## Current limits

- The source and target languages are fixed to Polish and English. There is no language picker, source-language detection, or per-site language preference yet.
- This is a first prototype; translation quality and interactive flows across real websites still need testing in Chrome. Allegro remains one example to include in that testing.
- Chrome UI, the Web Store, protected browser pages, and Chrome's PDF viewer are outside normal extension access.
- Images, canvas-drawn text, CSS-generated text, closed shadow roots, and native browser dialogs need other approaches (for example, an OCR feature).
- Cross-origin frames require permission for their own origin. Permission for the main website does not automatically cover third-party widgets or embedded applications.
- Open shadow roots inserted with a host are detected immediately. Roots attached later to existing hosts are discovered on interaction or within 2.5 seconds.
- Each DOM text node is translated independently; sentences split by inline markup can lose context. Nodes above 12,000 characters are currently skipped. Short brands and mixed-language text can produce imperfect results.
- The popup counts the main frame's text items, not aggregated iframe totals. Pausing is a per-tab override until navigation; turn off the site switch to disable future automatic translation.
- Websites that continuously rewrite their own UI can cause flicker or conflict with translated labels. Frameworks can depend on exact text-node content; test interactive flows before treating them as verified.

## Roadmap

1. **Configurable languages:** add source and target language controls, persist preferences, prepare the selected language packs, and separate translator sessions and cache entries by language pair.
2. **General website defaults:** replace the preselected website and special-case domain handling with user-selected site access and preferences.
3. **General interface text:** update setup, language labels, examples, and restoration controls to reflect the selected languages.
4. **Language-aware processing:** use the selected source language for sentence segmentation, then add source-language detection and handling for mixed-language pages.
5. **Broader website validation:** test dialogs, navigation, forms, embedded frames, and dynamically updated content across different websites and web applications.
6. **Translation quality:** group text split by inline markup and add optional user glossaries for names and recurring terms.
7. **Additional capabilities:** evaluate OCR for image/canvas text and optional external translation providers where the local engine does not meet the user's needs.

## API references

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Extension content scripts and frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
