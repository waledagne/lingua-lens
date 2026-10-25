import { chunks } from './segment';
self.onmessage = (event: MessageEvent<{ id: number; texts: string[] }>) => {
  self.postMessage({ id: event.data.id, parts: event.data.texts.map(text => chunks(text)) });
};
