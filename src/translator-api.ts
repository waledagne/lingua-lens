import type { LanguagePair } from './shared';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
export interface LocalTranslator { translate(text: string): Promise<string>; destroy(): void }
interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}
export interface TranslatorFactory {
  availability(options: LanguagePair): Promise<Availability>;
  create(options: LanguagePair & { monitor?: (monitor: DownloadMonitor) => void }): Promise<LocalTranslator>;
}
export function translatorAPI(): TranslatorFactory {
  const api = (globalThis as typeof globalThis & { Translator?: TranslatorFactory }).Translator;
  if (!api) throw new Error('Local translation is unavailable. Use Google Chrome 138 or newer on Windows and reopen setup.');
  return api;
}
