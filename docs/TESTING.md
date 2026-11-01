# Test Lingua Lens before publishing

The Chrome Web Store is not needed for local testing. Chrome supports loading an unpacked extension in Developer mode. [Chrome's installation instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Your part: use your regular Chrome

1. Open `chrome://extensions` and enable **Developer mode**. Click **Load unpacked** and select `C:\Users\Rog\Desktop\projects\lingua-lens\dist`. If already installed, click its reload button. Confirm **0.9.0**, pin Lingua Lens, and refresh the websites you will test.
2. Open **Languages & setup**, leave **From** on **Auto-detect**, choose your target, and enable detection. Keep setup open and connected to the internet. Complete the separate translation-pack step and check that a translated practice sample appears. **100% downloaded** still requires Chrome to prepare the model; success is **All set**, with the sample visible.
3. Open Allegro, invoke the toolbar, and choose **Translate this page**. Try product descriptions, a menu, a dialog, scrolling, and navigation. Confirm buttons and links still work and text you type is kept. Avoid Chrome's own page translation while testing, so only one tool changes the page.
4. Try a French and a Spanish page, such as [French MDN](https://developer.mozilla.org/fr/docs/Web/JavaScript) and [Spanish Firefox](https://www.firefox.com/es-ES/). Auto-detect should keep the same target. A newly encountered source can require its own translation pack.
5. Try **Bilingual paragraphs**, **Pause & restore original**, and the side panel. Translate a selection and a pasted paragraph. Send another selection while a draft exists: the draft should remain until you click **Use selection**. Copy and swap a completed translation.
6. Enable **Always translate this site**, reload that site, and verify it starts automatically. Turn the switch off and verify it stops on future visits. Also try **Never translate this site** and then remove the exclusion.

The most useful feedback is whether the translation is understandable and whether it fits your actual browsing. Automated DOM checks cannot assess that. A Mac Chrome test is useful if you have access to one; Windows testing does not establish Mac compatibility.

## If setup or translation fails

Cancel the operation, check compatibility again, and retry. A missing detector can be worked around by choosing a source manually. Update and restart Chrome if local models keep failing. These actions do not select a cloud fallback.

In **Languages & setup → Troubleshooting & diagnostics**, choose **Copy diagnostic report**. If clipboard access fails, copy the displayed report. Send the report with:

```text
Website URL:
Source (auto or manual) and target:
Reading mode (translated / bilingual / side panel):
Steps that caused the problem:
Expected result:
What actually happened / exact error:
```

The report contains the extension/browser version, platform, selected languages, model availability, and preparation flags. It excludes page text, website addresses, browsing history, and the full saved preference list. You choose whether to share it.

## Developer checks

```powershell
npm run check
npm run test:browser
npm run browser:doctor
npm run browser:smoke
npm run test:sites
```

- `check`: types, unit/integration tests, production build.
- `test:browser`: actual Chrome extension APIs, deterministic models. Includes a 600-paragraph backlog, new-dialog priority, draft preservation, and restoration.
- `browser:doctor`: native API availability only; does not download models.
- `browser:smoke`: production setup and real detector inference / Polish → English / Spanish → French sample translations. It uses an isolated persistent test profile, resets only that profile's extension preferences, and can download models. It writes `work/native-verification.json`; failures return a nonzero exit code. The default stage wait is 150 seconds. After building, run `node --import tsx scripts/browser-smoke.ts --timeout-ms=300000` for a longer allowance, or add `--translation-only` to skip detection. The application still stops a model after two minutes without advancing download progress or ten minutes total.
- `test:sites`: a separate extension copy with a **simulated translator**, and host grants only for configured public sites. Checks heading translation/restoration, a synthetic dynamic dialog, editing fields, and Wikipedia's native menu when available. It assesses DOM compatibility, not real model quality or complete shopping/account flows. Reports are written to `work/website-verification.json`. Blocked sites remain incomplete (exit 2); a failed check returns exit 1. After building, use `node --import tsx scripts/website-smoke.ts --only=www.firefox.com` to limit checks to a configured hostname.

All test profiles and reports are under ignored `work/`. Tests do not use a personal Chrome profile or modify installed Chrome. Production `dist/` contains no fake models or test-only host grants. See [the verification record](RELIABILITY.md) for results and remaining checks.

For page-speed changes, see [the performance measurements and viewport tests](PERFORMANCE.md). `npm run benchmark:page` uses simulated model latency and writes a local report.
