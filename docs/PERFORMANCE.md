# Page translation response — 0.9.0

Measured on 1 November 2026 (Africa/Nairobi), Windows, Chrome for Testing 156.0.8078.4. Baseline: committed 0.8.0 (`b540f82`). The measurements below use simulated model latency, not real model inference.

## What caused the slow sections

The old scheduler walked DOM order. Hidden navigation, offscreen sections, image alt text and tooltips could run before the words on screen. Each group waited for up to 32 distinct translations before painting, and every completed group incurred another 80 ms scheduling delay. Automatic mode could repeat all detection on a large page because its 128-context cache evicted the earlier contexts before replay reached them.

## Changes

- Viewport text and a small scrolling lookahead are prioritized with an IntersectionObserver. Open visible dialogs come first. Painted text and placeholders precede image alt text, tooltips and accessibility metadata; the remaining page continues in the background.
- The first request contains at most four distinct passages. Later requests adapt between one and 32, aiming for roughly 200 ms of measured work per update. Fast cache hits use larger groups. The next queued request starts without the old 80 ms pause; event-driven mutations still debounce normally.
- Successful source detection uses a bounded, in-memory LRU cache of up to 1,024 contexts / two million characters of context keys and results. Concurrent identical contexts share one inference. Short labels with a valid declared language use the same metadata fallback as before, without starting the detector unnecessarily.
- Queue counts include active work. Viewport tracking is cleaned up for detached text, and moved nodes discard their old pending response.

The existing local translation API still processes translations sequentially. [Chrome's API guidance](https://developer.chrome.com/docs/ai/translator-api).

## Controlled comparison

`benchmark-page.ts` runs the production DOM, detection, passage and translation classes in Chrome with identical fixtures. The document has 192 unique passages: 40 hidden, 140 offscreen, and 12 visible passages placed after that backlog in DOM order. Simulated detection takes 4 ms. The translator takes the latency shown per call. Model download/startup time is excluded.

| Scenario | Measurement | 0.8.0 | 0.9.0 |
| --- | --- | ---: | ---: |
| 8 ms translator, cold cache | First visible text | 3,102 ms | 105 ms |
| 8 ms translator, cold cache | All 12 visible passages | 3,102 ms | 245 ms |
| 8 ms translator, cold cache | All 192 passages | 3,110 ms | 2,675 ms |
| 40 ms translator, cold cache | First visible text | 9,730 ms | 206 ms |
| 40 ms translator, cold cache | All 12 visible passages | 9,730 ms | 754 ms |
| 40 ms translator, cold cache | All 192 passages | 9,741 ms | 9,645 ms |
| 8 ms translator, warm caches | All 192 passages | 1,296 ms | 54 ms |
| 8 ms translator, warm caches | Native detection calls | 152 | 0 |

Cold translation still needs 192 translation calls in both versions. The largest improvement is how soon visible content appears; full-page time with a slow model changes little. Warm results depend on the in-memory engine and detection caches still being available.

Reports: ignored `work/page-benchmark-before.json` and `work/page-benchmark-after.json`. These are single development measurements, not statistical benchmarks or a speed guarantee for other devices.

## Amazon.pl

The live Amazon.pl home page was reachable, and heading translation/restoration, a dynamic test dialog, and editing-field protection passed with the test-only translator. HTTP 202 returned the actual storefront, which was visually checked. The site changes between independent loads, so this is a smoke comparison rather than an identical-content benchmark. Timings and samples are recorded in `work/website-verification-amazon-before.json` and `work/website-verification-amazon-after.json` with a 40 ms simulated translator.

| Live Amazon.pl measurement | 0.8.0 | 0.9.0 |
| --- | ---: | ---: |
| First visible translated text | 9,671 ms | 1,004 ms |
| All 12 sampled visible text nodes | 12,581 ms | 2,647 ms |
| Total smoke-check time including navigation and functional checks | 20,025 ms | 19,462 ms |

The independent loads had 527 and 539 translated items respectively. The large improvement is visible response; total smoke duration is similar and includes network/page activity. These figures do not measure native model throughput.

Native inference speed, model startup, and parity with Google Translate remain unverified. Images and image-based banner lettering are outside DOM translation. Test 0.9.0 in your regular Chrome after reloading the extension and refreshing Amazon.pl; the expected improvement is earlier translation of the words you can see, with the remaining page continuing afterward.

## Reproduce and verify

```powershell
npm run check
npm run test:browser
npm run benchmark:page
node --import tsx scripts/website-smoke.ts --only=www.amazon.pl --latency-ms=40 --label=amazon-current
```

The website checker accepts `--extension=path-to-built-extension` to compare a saved build, while leaving production `dist/` unchanged. Test-only models and site grants are confined to `work/website-extension`. Its viewport timing samples the first 12 eligible text nodes and resamples after page updates rather than retaining stale nodes. It does not time image lettering, the full viewport, or a native translation model.

Regression tests cover visible-content ordering, scrolling into a queued section, dialog priority, metadata ordering, active queue counts, moved/detached nodes, large-page detection reuse, restoration, and protected editing fields.
