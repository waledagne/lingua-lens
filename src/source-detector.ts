import { LANGUAGES, languageName, type SourceContext } from './shared';
import type { DetectorFactory, LocalLanguageDetector } from './translator-api';

export function normalizeLanguage(value: string): string | null {
  const code = value.toLowerCase().replace(/_/gu, '-');
  if (/^zh-(hant|tw|hk|mo)(-|$)/u.test(code)) return 'zh-Hant';
  const base = code.split('-')[0];
  const normalized = base === 'nb' || base === 'nn' ? 'no' : base === 'iw' ? 'he' : base;
  return LANGUAGES.some(([language]) => language === normalized) ? normalized : null;
}
export function validateContext(value: unknown): SourceContext {
  const context = value as Partial<SourceContext> | null;
  if (!context || typeof context.sample !== 'string' || context.sample.length > 6000 || typeof context.pageLanguage !== 'string' || context.pageLanguage.length > 100) throw new Error('Invalid language detection context.');
  return { sample: context.sample, pageLanguage: context.pageLanguage };
}
export async function detectSource(detector: LocalLanguageDetector, context: SourceContext): Promise<string> {
  const hint = normalizeLanguage(context.pageLanguage);
  const enoughText = (context.sample.match(/\p{L}/gu)?.length ?? 0) >= 40;
  if (!enoughText && hint) return hint;
  if (!enoughText) throw new Error('There is not enough text to detect the page language reliably. Wait for the page to load and retry, or choose a source manually.');
  const candidates = (await detector.detect(context.sample)).filter(result => Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1).sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  if (best && best.confidence >= 0.7 && best.confidence - (candidates[1]?.confidence ?? 0) >= 0.15) {
    const language = normalizeLanguage(best.detectedLanguage);
    if (language) return language;
    throw new Error('The detected language (' + languageName(best.detectedLanguage) + ') is not supported by the local translator. Choose a source manually if detection is wrong.');
  }
  if (hint) return hint;
  throw new Error('The page language could not be detected confidently. Choose a source language manually and retry.');
}
export class SourceDetector {
  private instance?: Promise<LocalLanguageDetector>;
  private cache = new Map<string, string>();
  constructor(private api: () => DetectorFactory) {}
  async detect(context: SourceContext): Promise<string> {
    const key = context.pageLanguage + '\0' + context.sample;
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (!this.instance) this.instance = (async () => {
      const api = this.api();
      if (await api.availability() !== 'available') throw new Error('Open Lingua Lens setup to enable automatic language detection first.');
      return api.create();
    })().catch(error => { this.instance = undefined; throw error; });
    const result = await detectSource(await this.instance, context);
    this.cache.set(key, result);
    while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
}
