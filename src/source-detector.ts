import { LANGUAGES, languageName, type SourceContext } from './shared';
import type { DetectorFactory, LocalLanguageDetector } from './translator-api';
import { MODEL_CALL_MS, MODEL_CHECK_MS, modelTask } from './model-task';

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
  private cacheCharacters = 0;
  private pending = new Map<string, Promise<string>>();
  constructor(private api: () => DetectorFactory, private timeoutMs = MODEL_CALL_MS) {}
  detect(context: SourceContext): Promise<string> {
    const key = context.pageLanguage + '\0' + context.sample;
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return Promise.resolve(cached); }
    const active = this.pending.get(key);
    if (active) return active;
    const task = this.resolve({ ...context }).then(result => {
      this.cache.set(key, result); this.cacheCharacters += key.length + result.length;
      while (this.cache.size > 1024 || this.cacheCharacters > 2000000) {
        const [oldest, value] = this.cache.entries().next().value!;
        this.cache.delete(oldest); this.cacheCharacters -= oldest.length + value.length;
      }
      return result;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }
  private async resolve(context: SourceContext): Promise<string> {
    const hint = normalizeLanguage(context.pageLanguage);
    // Short UI labels already use markup as their source; no native startup is needed.
    if (hint && (context.sample.match(/\p{L}/gu)?.length ?? 0) < 40) return hint;
    if (!this.instance) this.instance = (async () => {
      const api = this.api();
      if (await modelTask(() => api.availability(), { timeoutMs: Math.min(this.timeoutMs, MODEL_CHECK_MS) }) !== 'available') throw new Error('Open Lingua Lens setup to enable automatic language detection first.');
      return modelTask(signal => api.create({ signal }), { timeoutMs: this.timeoutMs, dispose: value => value.destroy() });
    })().catch(error => { this.instance = undefined; throw error; });
    const pending = this.instance, instance = await pending;
    const result = await detectSource({
      detect: text => modelTask(() => instance.detect(text), { timeoutMs: this.timeoutMs }).catch(cause => {
        if (this.instance === pending) { this.instance = undefined; instance.destroy(); }
        throw cause;
      }), destroy() {},
    }, context);
    return result;
  }
}
