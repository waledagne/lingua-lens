# Reliability verification — 0.8.0

Checked on 1 November 2026 (Africa/Nairobi), Windows, Chrome for Testing 156.0.8078.4. This is a development verification record, not Chrome Web Store approval.

## Implemented recovery behavior

- Compatibility lookups stop after 15 seconds. Native detection/translation calls stop after 45 seconds. A page's queued requests can continue after an error; a failed translator is destroyed and a retry creates a fresh session.
- Model creation preserves its user gesture. Downloads stop after two minutes without advancing progress, with a ten-minute absolute cap. After 20 seconds without progress the visible setup/panel explains the wait and cancellation. Cancellation releases the UI even if a native promise ignores abort; late-created instances are destroyed.
- **Download complete** is distinct from a usable model. Setup saves readiness only after creation, and translation packs only after the practice translation succeeds.
- A failed or empty chunk is never accepted as a complete passage. One shared-detector timeout does not cause a separate timeout wait for every remaining context in the same batch. Already resolved language groups can still translate.
- Diagnostics can be copied or selected manually and include no page samples, URLs, or browsing history.

## Automated checks

119 unit/integration checks pass, exercising cancellation that ignores abort, late resource cleanup, stalled models, fresh-session recovery, incomplete output, metadata-only diagnostics, and existing translation behavior. The 16-test Chrome suite uses deterministic models and real extension APIs; it includes native side-panel opening and a long-page test.

The final recorded long-page run translated 600 unique paragraphs in **7,604 ms** with a simulated model adding 8 ms per translation call. A new dialog completed while **515** items remained pending. Editing text stayed intact and pause restored the final paragraph. This is a regression measurement in the test environment; real model throughput is unverified.

## Public website DOM checks

These checks used a separate extension copy with a simulated translator. Native model quality and full commercial/account flows are not covered.

| Page | Result | Evidence |
| --- | --- | --- |
| French MDN JavaScript documentation | Passed | 317 text items; heading, restoration, dynamic test dialog, editing-field protection |
| Polish Firefox home page | Passed | 177 text items; heading, restoration, dynamic test dialog, editing-field protection |
| Spanish Firefox home page | Passed | 141 text items; heading, restoration, dynamic test dialog, editing-field protection |
| Allegro home page | Incomplete | HTTP 403 in isolated Chrome |
| Polish Wikipedia translation article | Incomplete | HTTP 429 |
| Spanish Wikipedia translation article | Incomplete | Latest attempt returned HTTP 429; native-menu check still needs a completed run |

An earlier Spanish Wikipedia attempt reached the page but the test selected an overlaid label instead of the menu checkbox. The harness now targets the checkbox; access limits prevented revalidating the complete check. No bypass of site challenges is attempted.

## Native models and release checks

Native API availability reports Language Detector and Polish → English as **downloadable**. Availability alone is not a working translation. The full native run is preserved in local `work/native-verification-full.json`; the latest quick probe is in `work/native-verification.json`. Successful downloads, accuracy, and Mac Chrome compatibility must be established before release.

The baseline native run exceeded 90 seconds for detection and Polish → English; Polish preparation reported **100%** without returning a usable translator. The guarded 0.8.0 run reported:

| Native stage | Result | Elapsed |
| --- | --- | --- |
| Language detector preparation | Timed out with recoverable setup error | 123.3 seconds |
| Polish → English preparation | Download completed; usable model did not arrive before timeout | 120.4 seconds |
| Spanish → French preparation | Download completed; usable model did not arrive before timeout | 120.4 seconds |

The UI remained usable and the script continued to each next stage. The run used unmodified production code, a 135-second test-stage allowance, and the app's two-minute idle watchdog. It did **not** prove successful native inference or translation. The underlying model-preparation failure is unresolved in the isolated browser; do not treat passing simulated-model checks as a release sign-off.

A follow-up explicitly brought each setup tab to the foreground and tried the two translation pairs with a five-second allowance against the warmed test profile. Neither returned a sample in that short probe; foregrounding did not produce immediate recovery. This short probe is not evidence that either pair is unsupported.

Your regular Chrome remains the next verification environment, especially for Allegro, model readiness, translation quality, and everyday controls. Follow [TESTING.md](TESTING.md). Publishing to the Chrome Web Store is unnecessary for these tests.
