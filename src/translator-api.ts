import type { LanguagePair } from './shared';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
export interface LocalTranslator { translate(text: string): Promise<string>; destroy(): void }
export interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}
export interface LocalLanguageDetector {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
  destroy(): void;
}
export interface DetectorFactory {
  availability(): Promise<Availability>;
  create(options?: { monitor?: (monitor: DownloadMonitor) => void }): Promise<LocalLanguageDetector>;
}
export function detectorAPI(): DetectorFactory {
  const api = (globalThis as typeof globalThis & { LanguageDetector?: DetectorFactory }).LanguageDetector;
  if (!api) throw new Error('Automatic language detection is unavailable in this Chrome installation. Update Chrome or choose a source language manually.');
  return api;
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
