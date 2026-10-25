import { DomTranslator } from './dom-translator';
import { DEFAULT_PAIR, pairKey, request, type PageRequest, type TabState } from './shared';
import { collectSourceContext } from './source-context';

const scope = globalThis as typeof globalThis & { __linguaLens?: DomTranslator };
if (!scope.__linguaLens) {
  let pair = DEFAULT_PAIR;
  let configurationSequence = 0;
  let generation = 0;
  let detectedSource: string | null = null;
  const controller = new DomTranslator(document, async texts => {
    const snapshot = { ...pair }, version = generation;
    let source = snapshot.sourceLanguage;
    if (source === 'auto') {
      source = detectedSource ?? await request<string>({ target: 'background', type: 'detect', context: collectSourceContext(document), pair: snapshot });
      if (version !== generation) throw new Error('Language selection changed.');
      detectedSource = source;
    }
    return request<string[]>({ target: 'background', type: 'translate', texts, pair: snapshot, sourceLanguage: source });
  });
  const status = () => ({ ...controller.status(), detectedSource });
  scope.__linguaLens = controller;
  const configure = async () => {
    const sequence = ++configurationSequence;
    try {
      const state = await request<TabState>({ target: 'background', type: 'state' });
      if (sequence !== configurationSequence) return;
      if (pairKey(pair) !== pairKey(state.pair)) { controller.stop(); pair = state.pair; detectedSource = null; generation++; }
      if (state.enabled) controller.start(); else { controller.stop(); generation++; }
    } catch { if (sequence === configurationSequence) { controller.stop(); generation++; } }
  };
  chrome.runtime.onMessage.addListener((message: PageRequest, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'page') return;
    if (message.type === 'status') { respond(status()); return; }
    if (message.type === 'refresh') { void configure().then(() => respond(status())); return true; }
    respond(status());
  });
  void configure();
}
