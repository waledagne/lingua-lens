# Lingua Lens privacy policy

Last updated: 2 November 2026. Applies to extension version 0.9.0.

Lingua Lens translates website text and text you choose to paste or select using Chrome's on-device language detection and translation APIs. The extension does not operate a translation server, include analytics or advertising, sell personal data, or send your text to an external translation provider.

Lingua Lens uses accessed data only to provide its translation features. It does not use or transfer that data for advertising, creditworthiness, data brokerage, or unrelated purposes. The developer does not receive or read your translation text through the extension. This data handling follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Text the extension accesses

When you invoke page translation, Lingua Lens reads supported text and display labels on that page, including dynamically inserted content such as menus and dialogs. This can include hidden page interface text. Automatic translation runs on hostnames you explicitly enable. Cross-origin frames need their own access.

Form values, password fields, textareas, editable regions, code blocks, and regions marked not to translate are excluded from automatic page translation. This does not mean that all sensitive information on a page is excluded: ordinary displayed page text can contain personal information. Choose carefully where you grant access.

Selection actions read the passage you explicitly select outside protected editing regions. The translation panel processes text you paste or explicitly import. Original text, nearby language-detection context, and translated results are passed between extension components and Chrome's local APIs to provide these features.

## Storage and retention

- Language choices, reading preferences, preparation flags, automatic-translation hostnames, and site exclusions are saved in extension-local storage on your device. They are not synced by Lingua Lens to a developer service.
- Temporary tab overrides use Chrome's extension session storage.
- Page originals and translation queues remain in memory while their document is active; translation and detection caches are bounded and held in memory. They are not stored as translation history.
- Side-panel drafts and results stay in the panel document's memory and are cleared when that document closes. A pending selection handoff is held in background memory, consumed once, and expires after one minute. Closing its window clears it.
- Copying a result writes it to the system clipboard only when you click Copy. Clipboard retention is controlled by your operating system and other software.

Disable automatic translation for a site or revoke its site access in Chrome to stop future automatic processing. Uninstalling the extension removes its extension-managed local preferences; this does not remove copies you placed on the clipboard or shared yourself. Language models are managed by Chrome rather than by the extension.

## Downloads and diagnostics

Chrome may connect to Google's services to download and manage the models needed for local translation and detection. Those browser-managed services are subject to Google's terms and privacy practices. Lingua Lens does not add network requests that transmit your translation text, browsing history, or saved preferences to its developer.

Diagnostics are generated only when you request them. They include the extension and browser version, platform, chosen languages, native model availability, preparation flags, and capture time. They exclude page text, website addresses, browsing history, and the full preference list. The extension does not automatically upload reports. If you copy and share one, the service you choose receives it.

## Permissions

`activeTab` and `scripting` allow translation and explicit selection capture on a page you invoke. Optional HTTP/HTTPS host access supports sites you enable for automatic translation and permitted frames. `storage` saves the preferences and session state described above. `offscreen` hosts the local translation engine and its sentence-segmentation worker. `contextMenus` provides selection actions, and `sidePanel` provides the translation workspace. The extension requests no required access to every website at installation.

## Contact and changes

Privacy questions can be raised through the [Lingua Lens project issue tracker](https://github.com/waledagne/lingua-lens/issues). Avoid including private page text or personal information in a public issue. Future changes to data handling will be described in an updated policy.
