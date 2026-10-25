import { chunks } from './segment';
self.onmessage = (event: MessageEvent<{ id: number; texts: string[]; sourceLanguage: string }>) => {
  self.postMessage({ id: event.data.id, parts: event.data.texts.map(text => chunks(text, 1800, event.data.sourceLanguage)) });
};
