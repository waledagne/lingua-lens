# Lingua Lens

A translation extension that keeps up with the web as it changes. Lingua Lens aims to help you read websites in your preferred language, including text that appears after the page loads: dialogs, menus, notifications, and dynamically loaded content.

Built with **TypeScript** for desktop **Google Chrome**, using Chrome's local translation engine. Multiple languages and ordinary HTTP(S) websites are supported. Development and browser testing currently run on Windows; the same extension package is intended for Chrome on macOS, but Mac testing is still outstanding.

## Project direction

- **Choose your target:** detect the source language automatically, with a manual source override when needed.
- **Use across websites:** translate the current website on demand and remember which sites should translate automatically.
- **Continuous translation:** handle the initial page and newly added or changed text without requiring a full-page refresh.
- **Control over the original:** pause translation, restore source text, and preserve text you are editing.
- **Local translation first:** use on-device translation where available, with any future external provider offered as an explicit option.

Detection and translation use Chrome's local models. Additional translation providers remain future work.

## Version 0.5: bilingual reading and original passages

Expand **Languages & reading** in the toolbar and choose **Bilingual paragraphs** from **Reading mode**. Complete reading blocks are translated across inline markup, so `A <strong>good</strong> product` is sent as one passage. The original block, formatting, and links stay in place; its plain-text translation appears underneath. Headings, paragraphs, simple list items, quotes, captions, and definition items can be grouped. Newly inserted blocks and changed or removed inline text update through the same observer.

Reading mode can be saved as a default or for the current hostname using **Save preferences for**. **Use default settings on this site** removes both its language and reading-mode overrides. Changing modes restores originals and removes old bilingual output before rendering again. Pausing removes all extension-added translations while retaining website edits.

**Translated only** keeps the existing text-node replacement behavior to preserve interactive controls. Bilingual mode also uses that behavior for UI labels, attributes, and complex blocks containing controls, nested reading blocks, protected regions, or more than 12,000 characters. Translations underneath paragraphs are plain text; original links remain clickable above them. Source and target matches, including understood-language passthrough, do not produce duplicate reading blocks.

Select translated page text and use **Reveal original selection**, the right-click **Lingua Lens → Reveal original** action, or `Alt+Shift+O`. The panel compares the saved original passage with the current translation without another model request. It can include surrounding text because translation does not provide an exact source-to-target character mapping. It excludes editing fields and returns no saved original for text the website has since changed or for a paused page. The same action works in accessible frames.

## Version 0.4: everyday translation controls

- **Guided setup:** first installation opens setup. Choose a target, prepare the local models, and run a real sample translation without needing a website. Compatibility errors offer a manual-source recovery path. Downloads have progress and cancellation; preparation can be retried.
- **Website preferences:** save languages as the default or for one exact hostname. A site's language choice survives changes to the default. Reset it to inherit the default again. Setup opened from that site's toolbar uses its effective languages.
- **Automatic or excluded:** remember automatic translation per site, or select **Never translate this site** to stop translation across its open tabs and unregister automatic injection. Removing the exclusion does not silently re-enable automatic translation.
- **Languages you understand:** choose languages to keep in their original form during automatic page translation. Explicit selection translation and manual source choices still translate when requested.
- **Selected-text translation:** highlight a passage and use the right-click menu, toolbar button, or shortcut. A separate panel shows the original, translation, copy action, and setup link without replacing page content. Escape closes it. Editing fields are excluded; passages are limited to 12,000 characters. A frame needs its own site access when it has a different origin.
- **Keyboard actions:** `Alt+Shift+Y` translates selected text; `Alt+Shift+L` translates or restores the page. On Mac, Alt is Option. Setup shows the shortcuts Chrome actually assigned and links to `chrome://extensions/shortcuts` for customization. Conflicts can leave shortcuts unassigned.

The added `contextMenus` permission supplies the selection action. It does not add required website access. Page text is not saved to local storage; the selection panel and translation cache stay in memory.

## Using Lingua Lens

The source defaults to **Auto-detect**. Choose your target language in the toolbar popup or setup page, then click **Apply languages**. In the popup, **Save preferences for** selects the default for all websites or an override for the current hostname. Each page/frame detects its own source. A manual source choice is available for ambiguous or incorrectly identified pages.

Use the toolbar on any ordinary HTTP(S) website that Chrome permits extensions to access. No website is enabled automatically by default, and there are no website-specific translation rules or required host permissions. **Always translate this site** requests access to the chosen hostname and enables automatic translation there.

The code currently includes:

- Page text and display-attribute translation, plus observation of newly inserted or updated content.
- Dialog and menu handling through the same DOM observer, rather than site-specific translation rules.
- Open shadow-root discovery and content scripts in frames where site access permits them.
- Per-tab pause and restoration, per-site automatic translation, and local language-pack setup.
- Queued translation, duplicate-text caching, and checks that prevent late responses from overwriting newer page content.
- Saved language choices, preparation status for each language pair, translator sessions and caches separated by pair, and sentence segmentation using the selected source language.
- Local page-language detection from a text sample, fallback to the page's declared language, and passthrough when the page already uses the target language.

Changing effective language preferences restores original page text before translating again. In automatic mode the local detector is prepared once; a newly detected source may need its own one-time translation-pack download. Responses from old language selections, including pending detection results, are ignored after switching.

## Load the first version

The built extension is already in `dist/`.

1. Open `chrome://extensions` in **Google Chrome 138 or newer**.
2. Turn on **Developer mode**, choose **Load unpacked**, and select the project's `dist/` folder.
3. Pin **Lingua Lens** and open its toolbar popup on a website. Expand **Languages & reading**, leave **From** on **Auto-detect**, choose **To**, then click **Apply languages**.
4. Click **Enable automatic detection** when prompted, or open **Languages & setup**. Setup opened from a website's popup can read that page's sample to determine the required source language.
5. On the setup tab, enable the local detector. If the detected pair needs a pack, click **Download & enable translation** (or **Enable & test translation**) as a separate step. Chrome requires a user action for first-time model downloads; keep the setup tab open. You do not need to choose the detected source manually.
6. Return to the website and choose **Translate this page** or **Retry translation**. The popup shows the detected source. Pages already in the target language keep their original text. Try opening a dialog or menu to check newly added content.
7. Use **Always translate this site** to enable translation on future visits. Chrome will request access to that hostname when needed.
8. Use **Pause & restore original** to restore source text. Pausing lasts until navigation; disable the site switch to stop future automatic translation.

After updating an existing unpacked installation, reload the extension in `chrome://extensions` and refresh any pages that were already translated. Version 0.5 preserves existing language choices, prepared pairs, permitted automatic sites, exclusions, and understood languages. Reading mode defaults to **Translated only** until changed. Older installations from before version 0.3 migrate to automatic detection while retaining the target and previous pack preparation.

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
npm run browser:prepare
npm run test:browser
```

`browser:prepare` is optional: `test:browser` also prepares the runtime automatically. On Windows, preparation copies the complete bundled Chrome for Testing distribution into the ignored `work/playwright-browser/` directory, including its versioned manifest and DLLs. The project-local copy inherits workspace access and avoids the side-by-side assembly-resolution failure observed when launching directly from the shared download cache. It is reused until the bundled executable changes; missing assembly files trigger a repair copy. The shared cache, installed Chrome, system permissions, and registry are not modified.

Browser tests launch a separate temporary profile and a test copy of the extension. Only that extension copy gets deterministic fake Translator and Language Detector implementations; **production `dist/` always calls the real Chrome APIs**. The suite verifies actual Chrome extension messaging, permissions, offscreen documents, workers, frame injection, dynamic DOM updates, restoration, and popup controls. It does not validate real model accuracy. `LINGUA_LENS_BROWSER` can explicitly select another compatible Chrome for Testing executable. The test launcher does not open your personal Chrome profile.

Use `npm run browser:doctor` to launch the unmodified production extension and print the real browser version and native model availability. It does not call model creation; Chrome may perform its normal background component updates. Native checks re-enable the model services, component updates, and background networking that Playwright normally suppresses, while retaining unrelated launch defaults. A successful launch does not mean models are available or translation works.

The latest corrected native availability check reported both Language Detector and Polish → English as `downloadable`. Actual detector and Spanish → French setup attempts did not finish within the 90-second test window. Native download completion and accuracy are not verified by the passing automated suite.

`npm run browser:smoke` attempts actual detector preparation and Polish → English / Spanish → French sample translations through production setup. It can download models, reports failures with a nonzero exit code, and uses only the ignored `work/native-model-profile` profile. It resets that profile's extension preferences on each run while retaining Chrome's downloaded models. After building, use `node --import tsx scripts/browser-smoke.ts --translation-only` to check translation without waiting for detector preparation. No personal Chrome profile is used. Downloads are given 90 seconds per stage; a timeout does not prove that the language is unsupported.

The Windows runtime workaround follows the private-assembly requirement that manifests accompany their DLLs. [Microsoft assembly documentation](https://learn.microsoft.com/en-us/windows/win32/sbscs/assembly-manifests). The persistent, isolated Chromium launch follows [Playwright's extension-testing guidance](https://playwright.dev/docs/chrome-extensions).

Validation covers TypeScript checking, the production build, 78 unit/integration tests, and 11 browser tests in Chrome for Testing 156.0.8078.4. Tests cover UI/content scripts, detection, migration, permissions, caching, stale responses, runtime preparation, per-site settings, exclusion across tabs, selection and frames, copy, assigned commands, and cancelled setup. Reading tests cover paragraph context across inline markup, line breaks, removed/replaced nodes, mode switches during pending requests, protected regions, shadow roots, restoration, and original reveal without a model request. The browser suite exercises real extension APIs with deterministic models; keyboard and context-menu event routing is also tested with mocks. Real native-model completion, accuracy, Mac compatibility, and live commercial website flows remain release verification tasks.

## Troubleshooting automatic translation

If **Always translate this site** reports `Only permissions specified in the manifest may be requested.`, reload the rebuilt extension from `chrome://extensions`, confirm version **0.3.1** or later, refresh the website, and retry the switch.

The fix requests separate `http://hostname/*` and `https://hostname/*` permissions to match the manifest's optional scheme declarations. Permission checks and registered scripts use the same explicit patterns. Existing saved wildcard registrations are updated when the extension initializes. If you decline website access, automatic translation stays off and manual translation remains available.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/dom-translator.ts` | Observe changes, discover open shadow roots, queue text, preserve originals, reject stale responses |
| `src/paragraph.ts` | Identify reading blocks, snapshot inline text, and render isolated bilingual output |
| `src/content.ts` | One controller per permitted document/frame; message bridge |
| `src/background.ts` | Tab state, settings, optional site access, script registration, engine lifecycle |
| `src/engine.ts` | Offscreen messaging and the sentence-segmentation worker |
| `src/translation-engine.ts` | Sequential queue, per-pair translation caches, and a bounded pool of Translator sessions |
| `src/source-detector.ts` | Local detector lifecycle, confidence checks, regional-language normalization, and bounded detection cache |
| `src/source-context.ts` | Bounded page samples that exclude editable fields and explicitly hidden/excluded regions |
| `src/segment-worker.ts` | Split long text into sentence-sized chunks in a worker |
| `src/languages.ts` | Language options, pair validation, names, and sample text |
| `src/settings.ts` | Stored-preference validation, migration, and pair-specific readiness |
| `src/selection.ts` / `src/selection-panel.ts` | Capture non-editable selections and display isolated, dismissible translation results |
| `src/shared.ts` | Shared messages, settings types, and website-access helpers |
| `src/language-controls.ts` | Shared language selectors and swap control |
| `src/popup.ts` / `public/popup.html` | Translate, pause, restore, remember site, and display status |
| `src/setup.ts` / `public/setup.html` | User-initiated language-pack download and a real translation check |

The local Translator and Language Detector APIs require a document context, so they run in an offscreen document, not the extension service worker. The sentence-segmentation worker is the reason for the `offscreen` permission's `WORKERS` use. Initial model creation happens from clicks in the visible setup document on the extension's origin; the offscreen engine then reuses that origin's prepared models.

The DOM translation controller provides common page handling across websites. Automatic mode samples the page before translating, detects its source once per document/frame, and reuses that result for new content. Each translation request carries a snapshot of the preferences and resolved source. The background rejects outdated selections and skips the translator when source equals target. The content controller restores source text and invalidates pending work when preferences change.

Translation replaces text-node data and selected display attributes (`title`, `aria-label`, `placeholder`, `alt`), never `innerHTML`. This preserves element identities and click listeners. Form values, passwords, textareas, editable regions, code, and `translate="no"` regions are excluded. Options without explicit values are excluded because their labels can determine submitted values. New dialogs are prioritized over the initial backlog. Responses apply only when the node still contains the original source and translation is still enabled. Restoring originals preserves subsequent website changes.

## Access and privacy

- Manual translation uses Chrome's temporary `activeTab` grant when you invoke the toolbar extension. There is no required access to any website at installation.
- Enabling **Always translate this site** requests optional access to that exact hostname for HTTP and HTTPS and registers its content script persistently. Subdomains are separate sites.
- Disable the site switch to stop automatic translation and remove its registration. Chrome's site-access settings can revoke the granted permission; revoked sites are removed from automatic translation.
- Page samples and translatable text pass only between extension components and Chrome's local models. Samples are limited to 6,000 characters and exclude input fields, editable areas, and explicitly hidden/excluded content. Setup links do not include page samples or selected passages. The extension includes no network translation requests, analytics, API keys, or remote scripts.
- Preferences are saved in extension-local storage. Tab overrides use session storage; translated text is held only in a bounded in-memory cache.
- Selected text is read only when you invoke a selection action. Its original and translation appear in the in-page panel and may enter the in-memory translation cache. Copy writes the translation to the clipboard only when clicked. Selected text is never placed in setup URLs or saved preferences.
- Site access means all relevant text can be read, including hidden page UI. Do not enable automatic translation on sites where you do not want this behavior.

## Current limits

- The language menu reflects Chrome's documented language list. Availability is checked for the selected pair on the device; listed languages do not guarantee every pair is available in every Chrome installation.
- Language defaults can be overridden per hostname. Detection chooses one main source per document/frame, rather than detecting each individual text node. Mixed-language pages or a single-page application that changes its main language may need a refresh or manual source override. Automatic selection translation detects the selected passage; short selections can fall back to the document's declared language.
- A supported page-language declaration is used when the sample is short or the model is uncertain. Without a reliable declaration or sufficiently confident sample, the extension asks for a manual source rather than silently guessing. Detection does not make every language supported by the translator.
- This is a prototype; translation quality and interactive flows across real websites still need testing in Chrome.
- Chrome UI, the Web Store, protected browser pages, and Chrome's PDF viewer are outside normal extension access.
- Images, canvas-drawn text, CSS-generated text, closed shadow roots, and native browser dialogs need other approaches (for example, an OCR feature).
- Cross-origin frames require permission for their own origin. Permission for the main website does not automatically cover third-party widgets or embedded applications.
- Open shadow roots inserted with a host are detected immediately. Roots attached later to existing hosts are discovered on interaction or within 2.5 seconds.
- Translated-only mode handles DOM text nodes independently; sentences split by inline markup can lose context. Bilingual mode groups eligible reading blocks across inline markup. Complex blocks fall back to text-node translation; individual nodes above 12,000 characters are skipped. Short brands and mixed-language text can produce imperfect results.
- The popup counts the main frame's text items, not aggregated iframe totals. Pausing is a per-tab override until navigation; turn off the site switch to disable future automatic translation.
- Websites that continuously rewrite their own UI can cause flicker or conflict with translated labels. Frameworks can depend on exact text-node content; test interactive flows before treating them as verified.

## Roadmap

1. **Mixed-language detection:** improve sampling and detect independent language regions within a page.
2. **Reading improvements:** refine block discovery on complex layouts and support more inline context while retaining working website controls.
3. **Broader website validation:** test dialogs, navigation, forms, embedded frames, and dynamically updated content across different websites and web applications.
4. **Translation quality:** group text split by inline markup and add optional user glossaries for names and recurring terms.
5. **Additional capabilities:** evaluate OCR for image/canvas text and optional external translation providers where the local engine does not meet the user's needs.

## API references

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Language Detector API](https://developer.chrome.com/docs/ai/language-detection)
- [Extension content scripts and frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
