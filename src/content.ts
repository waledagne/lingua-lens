import { DomTranslator } from './dom-translator';
import { DEFAULT_PAIR, pairKey, request, type PageRequest, type TabState } from './shared';

const scope = globalThis as typeof globalThis & { __linguaLens?: DomTranslator };
if (!scope.__linguaLens) {
  let pair = DEFAULT_PAIR;
  let configurationSequence = 0;
  const controller = new DomTranslator(document, texts => request<string[]>({ target: 'background', type: 'translate', texts, pair: { ...pair } }));
  scope.__linguaLens = controller;
  const configure = async () => {
    const sequence = ++configurationSequence;
    try {
      const state = await request<TabState>({ target: 'background', type: 'state' });
      if (sequence !== configurationSequence) return;
      if (pairKey(pair) !== pairKey(state.pair)) { controller.stop(); pair = state.pair; }
      if (state.enabled) controller.start(); else controller.stop();
    } catch { if (sequence === configurationSequence) controller.stop(); }
  };
  chrome.runtime.onMessage.addListener((message: PageRequest, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'page') return;
    if (message.type === 'status') { respond(controller.status()); return; }
    if (message.type === 'refresh') { void configure().then(() => respond(controller.status())); return true; }
    respond(controller.status());
  });
  void configure();
}
