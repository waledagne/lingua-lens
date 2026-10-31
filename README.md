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

## Version 0.8: reliability and local testing

Model downloads, compatibility checks, detection, and translation now have bounded waits. Cancel releases setup and panel controls even when a native call ignores abort; late model instances are discarded. A failed page translator is replaced on retry, and one stalled detector no longer creates a separate timeout for every remaining context in its batch. Empty translation chunks cannot be cached as a complete passage.

Setup and the side panel distinguish a completed download from Chrome finishing model preparation, show an explanation after a long wait, and stop stalled downloads after two minutes without advancing progress (ten minutes maximum). Ordinary native inference calls have a 45-second limit; compatibility checks have 15 seconds. Downloads still require an explicit user gesture and Chrome's native APIs; no cloud fallback is added.

Open **Languages & setup → Troubleshooting & diagnostics → Copy diagnostic report** for browser/extension versions, selected languages, native availability, and preparation flags. The report excludes page text, website addresses, browsing history, and full saved preferences. If clipboard access fails, select the displayed report manually.

**No Web Store publication is needed for testing.** Load or reload `dist/` as an unpacked extension. Follow [your testing steps](docs/TESTING.md) and see [the verification record and remaining checks](docs/RELIABILITY.md). Automated browser and live-site DOM checks use simulated models; actual model readiness and translation quality remain separate checks.

## Version 0.7: translation workspace

Open **Open translation panel** in the toolbar, or use `Alt+Shift+K` (Option+Shift+K on Mac, if assigned). Chrome's side panel stays beside your website as you switch tabs within the same window. The existing toolbar and in-page selection translator remain available.

- **Paste and translate:** paste up to 12,000 characters, leave the source on Auto-detect, and choose a target. The panel saves its own language choices; it does not change website defaults or per-site preferences. Short pasted phrases without a reliable source hint require a manual source.
- **Bring in selections:** right-click highlighted website text and choose **Send selection to side panel**, or select text on the page and click **Use page selection** in the panel. Imports require temporary access granted by a toolbar, shortcut, or context-menu invocation, or saved host access. Editing fields and excluded sites are not imported; you can paste text yourself. Cross-origin frames require their own access.
- **Protect drafts:** an incoming selection appears as a preview when a draft already exists. **Use selection** replaces it only when clicked; **Dismiss** keeps your work. Importing never starts translation automatically.
- **Prepare locally:** missing detector or translation models offer a separate enable/download click, with progress and cancellation. Unsupported pairs report an error. Text already in the target language keeps its original form.
- **Work with results:** copy the translation, swap languages and translate back, clear the workspace, or cancel an operation. Editing text or languages cancels the old operation and prevents late results from replacing newer work.

The added `sidePanel` permission provides the browser workspace. It adds no required host access. Pasted drafts and translations stay in panel memory and are cleared when its document closes; they are not sent through background translation messages or saved as history. A selection handoff stays briefly in background memory, is consumed once, and expires after one minute. Closing the browser window clears its pending handoff. Copy writes only when clicked. Chrome may download local models; the extension has no cloud translation provider.

## Version 0.6: mixed-language pages

**Auto-detect** now resolves the source separately for each passage instead of fixing one source for an entire document. A page can contain Polish, French, and Spanish passages, each translated into your chosen target. Passages already in the target language, or in a language you understand, keep their originals. A manual source choice still explicitly applies one source to the page.

Detection uses up to 1,600 characters of original context from the passage's reading block or local language region. Inline fragments use nearby original text, including saved originals of text already translated by the extension. Short or uncertain passages use the nearest declared `lang`, inherited across open shadow-root hosts. Confident text detection can override incorrect markup. Bilingual grouping splits at declared language boundaries so separate languages are not merged into one translation request.

New and changed passages are detected again. Changes to `lang`, `hidden`, or `aria-hidden` restore affected originals and refresh their contexts, including in accessible shadow roots. This handles language changes during navigation within a website without reloading the extension. Explicitly hidden content does not advertise unresolved issues until it becomes visible.

Missing packs and uncertain passages produce **Partial** status. Those passages retain their original text while other language groups continue translating. The popup lists the affected source and offers its pack setup, **Retry translation**, and **Pause & restore original**. Preparing the requested pack retains automatic source selection and the current target. Unknown source languages still need a manual source or better page context; the extension does not send text to a cloud fallback.

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

The source defaults to **Auto-detect**. Choose your target language in the toolbar popup or setup page, then click **Apply languages**. In the popup, **Save preferences for** selects the default for all websites or an override for the current hostname. Each passage can use a different detected source. A manual source choice is available for ambiguous or incorrectly identified pages.

Use the toolbar on any ordinary HTTP(S) website that Chrome permits extensions to access. No website is enabled automatically by default, and there are no website-specific translation rules or required host permissions. **Always translate this site** requests access to the chosen hostname and enables automatic translation there.

The code currently includes:

- Page text and display-attribute translation, plus observation of newly inserted or updated content.
- Dialog and menu handling through the same DOM observer, rather than site-specific translation rules.
- Open shadow-root discovery and content scripts in frames where site access permits them.
- Per-tab pause and restoration, per-site automatic translation, and local language-pack setup.
- Queued translation, duplicate-text caching, and checks that prevent late responses from overwriting newer page content.
- Saved language choices, preparation status for each language pair, translator sessions and caches separated by pair, and sentence segmentation using the selected source language.
- Local passage-language detection, fallback to the nearest declared language, and passthrough for target and understood languages.

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

After updating an existing unpacked installation, reload the extension in `chrome://extensions` and refresh any pages that were already translated. Version 0.8 preserves existing language choices, reading modes, panel preferences, prepared pairs, permitted automatic sites, exclusions, and understood languages. Open Languages & setup to try the new diagnostic report. Older installations from before version 0.3 migrate to automatic detection while retaining the target and previous pack preparation.

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

The native availability check reports Language Detector and Polish → English as `downloadable`. Model readiness and accuracy remain unverified; a baseline Polish → English setup reached 100% downloaded without returning a usable translator. See [the verification record](docs/RELIABILITY.md) for native outcomes, accessible public sites, blocked sites, and the long-page measurement.

`npm run browser:smoke` attempts real detector inference and Polish → English / Spanish → French sample translations through production setup. It can download models, reports failures with a nonzero exit code, and uses only the ignored `work/native-model-profile` profile. It resets that profile's extension preferences on each run while retaining Chrome's downloaded models. Results and component metrics are saved to `work/native-verification.json`. The default stage allowance is 150 seconds; after building, use `node --import tsx scripts/browser-smoke.ts --timeout-ms=300000` to change it, or add `--translation-only` to skip detection. App-level idle and total timeouts still apply. No personal Chrome profile is used; a timeout does not establish that a language is unsupported.

`npm run test:sites` checks configured public websites with a separate extension copy and a simulated translator. It verifies DOM integration and writes `work/website-verification.json`; it does not validate translation quality. Site blocks are reported as incomplete. See [testing commands and report formats](docs/TESTING.md).

The Windows runtime workaround follows the private-assembly requirement that manifests accompany their DLLs. [Microsoft assembly documentation](https://learn.microsoft.com/en-us/windows/win32/sbscs/assembly-manifests). The persistent, isolated Chromium launch follows [Playwright's extension-testing guidance](https://playwright.dev/docs/chrome-extensions).

Validation covers TypeScript checking, the production build, 119 unit/integration tests, and 16 browser tests in Chrome for Testing 156.0.8078.4. Tests cover UI/content scripts, detection, migration, permissions, caching, stale responses, runtime preparation, per-site settings, exclusion across tabs, selection and frames, copy, assigned commands, and cancelled setup. Reading and mixed-language tests cover inline context, language boundaries, source-specific duplicate labels, missing-pack isolation and recovery, understood-language passthrough, live language/visibility changes, protected drafts, shadow roots, restoration, and original reveal without a model request. Panel tests cover staged user-gesture downloads, independent preferences, draft handoffs, cancellation, oversized input, copying, and narrow layouts. Browser coverage opens a real native side panel and captures and translates a page selection inside it. The browser suite exercises real extension APIs with deterministic models; keyboard and context-menu event routing is also tested with mocks. Real native-model completion, accuracy, Mac compatibility, and live commercial website flows remain release verification tasks.

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
| `src/model-task.ts` | Gesture-preserving native calls, bounded waits, cancellation, and cleanup of late model instances |
| `src/diagnostics.ts` | Metadata-only browser/model diagnostic report |
| `src/source-detector.ts` | Local detector lifecycle, confidence checks, regional-language normalization, and bounded detection cache |
| `src/passage-engine.ts` | Validate passage batches, detect sources, group translation by language, and isolate failures |
| `src/passage-context.ts` / `src/dom-language.ts` | Sample original local context, honor language boundaries, and inherit metadata across shadow hosts |
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

The DOM controller provides common handling across websites. Automatic batches include up to 32 text items and matching local detection contexts, with at most 24,000 text characters and 1,600 context characters per item. Deduplication includes context and language hints so identical labels in different regions do not share the wrong source. The background validates the batch and forwards trusted language preferences to the offscreen engine. The engine detects each context, groups requests by source, skips target/understood languages, and returns per-passage issues. Settings changes and changed or replaced DOM entries reject stale output.

Translation replaces text-node data and selected display attributes (`title`, `aria-label`, `placeholder`, `alt`), never `innerHTML`. This preserves element identities and click listeners. Form values, passwords, textareas, editable regions, code, and `translate="no"` regions are excluded. Options without explicit values are excluded because their labels can determine submitted values. New dialogs are prioritized over the initial backlog. Responses apply only when the node still contains the original source and translation is still enabled. Restoring originals preserves subsequent website changes.

## Access and privacy

- Manual translation uses Chrome's temporary `activeTab` grant when you invoke the toolbar extension. There is no required access to any website at installation.
- Enabling **Always translate this site** requests optional access to that exact hostname for HTTP and HTTPS and registers its content script persistently. Subdomains are separate sites.
- Disable the site switch to stop automatic translation and remove its registration. Chrome's site-access settings can revoke the granted permission; revoked sites are removed from automatic translation.
- Page samples and translatable text pass only between extension components and Chrome's local models. Setup/selection detection samples are limited to 6,000 characters; automatic passage contexts are limited to 1,600 characters each. Context sampling excludes editing fields, protected regions, explicitly hidden content, and extension UI. Setup links can include a source-language code for pack preparation, but never page samples or selected passages. The extension includes no network translation requests, analytics, API keys, or remote scripts.
- Preferences are saved in extension-local storage. Tab overrides use session storage; translated text is held only in a bounded in-memory cache.
- The persistent side panel saves language preferences only. Drafts and results stay in its document memory. Its per-window incoming selection queue is held in background memory, never in storage or URLs. See the version 0.7 workspace section above.
- Selected text is read only when you invoke a selection action. Its original and translation appear in the in-page panel and may enter the in-memory translation cache. Copy writes the translation to the clipboard only when clicked. Selected text is never placed in setup URLs or saved preferences.
- Site access means all relevant text can be read, including hidden page UI. Do not enable automatic translation on sites where you do not want this behavior.

## Current limits

- The language menu reflects Chrome's documented language list. Availability is checked for the selected pair on the device; listed languages do not guarantee every pair is available in every Chrome installation.
- Language defaults can be overridden per hostname. Automatic mode chooses a source from each local context, rather than identifying every individual word. Unmarked sentences that mix several languages can still resolve to one dominant language. Short labels can rely on declared metadata; incorrect metadata can therefore mislead detection when there is too little text. Automatic selection translation detects the selected passage; short selections can fall back to the document's declared language.
- A supported page-language declaration is used when the sample is short or the model is uncertain. Without a reliable declaration or sufficiently confident sample, the extension asks for a manual source rather than silently guessing. Detection does not make every language supported by the translator.
- This is a prototype; translation quality and interactive flows across real websites still need testing in Chrome.
- Chrome UI, the Web Store, protected browser pages, and Chrome's PDF viewer are outside normal extension access.
- Images, canvas-drawn text, CSS-generated text, closed shadow roots, and native browser dialogs need other approaches (for example, an OCR feature).
- Cross-origin frames require permission for their own origin. Permission for the main website does not automatically cover third-party widgets or embedded applications.
- Open shadow roots inserted with a host are detected immediately. Roots attached later to existing hosts are discovered on interaction or within 2.5 seconds.
- Translated-only mode handles DOM text nodes independently; sentences split by inline markup can lose context. Bilingual mode groups eligible reading blocks across inline markup. Complex blocks fall back to text-node translation; individual nodes above 12,000 characters are skipped. Short brands and mixed-language text can produce imperfect results.
- The popup's counts, detected-language list, and partial-translation notices cover the main frame. Child frames translate independently; a pack needed only by a child frame can require manual language setup. Pausing is a per-tab override until navigation; turn off the site switch to disable future automatic translation.
- Websites that continuously rewrite their own UI can cause flicker or conflict with translated labels. Frameworks can depend on exact text-node content; test interactive flows before treating them as verified.

## Roadmap

1. **Detection quality:** refine unmarked mixed-language sentences and ambiguous short labels across different page layouts.
2. **Reading improvements:** refine block discovery on complex layouts and support more inline context while retaining working website controls.
3. **Broader website validation:** test dialogs, navigation, forms, embedded frames, and dynamically updated content across different websites and web applications.
4. **Translation quality:** group text split by inline markup and add optional user glossaries for names and recurring terms.
5. **Additional capabilities:** evaluate OCR for image/canvas text and optional external translation providers where the local engine does not meet the user's needs.

## API references

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Language Detector API](https://developer.chrome.com/docs/ai/language-detection)
- [Extension content scripts and frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome side panels](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
