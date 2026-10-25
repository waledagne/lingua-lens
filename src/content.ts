import { DomTranslator } from './dom-translator';
import { request, type PageRequest, type TabState } from './shared';

const scope = globalThis as typeof globalThis & { __linguaLens?: DomTranslator };
if (!scope.__linguaLens) {
  const controller = new DomTranslator(document, texts => request<string[]>({ target: 'background', type: 'translate', texts }));
  scope.__linguaLens = controller;
  const configure = async () => {
    try {
      const state = await request<TabState>({ target: 'background', type: 'state' });
      if (state.enabled) controller.start(); else controller.stop();
    } catch { controller.stop(); }
  };
  chrome.runtime.onMessage.addListener((message: PageRequest, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'page') return;
    if (message.type === 'status') { respond(controller.status()); return; }
    if (message.type === 'start') controller.start();
    if (message.type === 'stop') controller.stop();
    if (message.type === 'refresh') { void configure().then(() => respond(controller.status())); return true; }
    respond(controller.status());
  });
  void configure();
}
