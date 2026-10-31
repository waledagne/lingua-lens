import { pairKey, pairLabel, withPadding, type LanguagePair } from './shared';
import type { LocalTranslator, TranslatorFactory } from './translator-api';
import { MODEL_CALL_MS, MODEL_CHECK_MS, modelTask } from './model-task';

export class TranslationEngine {
  private sessions = new Map<string, LocalTranslator>();
  private cache = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private api: () => TranslatorFactory, private split: (texts: string[], sourceLanguage: string) => Promise<string[][]>, private timeoutMs = MODEL_CALL_MS) {}
  translate(texts: string[], pair: LanguagePair): Promise<string[]> {
    const snapshot = { ...pair };
    const task = this.queue.then(() => this.run(texts, snapshot));
    this.queue = task.catch(() => {});
    return task;
  }
  private async session(pair: LanguagePair): Promise<LocalTranslator> {
    const key = pairKey(pair);
    let instance = this.sessions.get(key);
    if (instance) this.sessions.delete(key);
    else {
      const api = this.api();
      if (await modelTask(() => api.availability(pair), { timeoutMs: Math.min(this.timeoutMs, MODEL_CHECK_MS) }) !== 'available') throw new Error(`Open Lingua Lens setup to prepare ${pairLabel(pair)} first.`);
      instance = await modelTask(signal => api.create({ ...pair, signal }), { timeoutMs: this.timeoutMs, dispose: value => value.destroy() });
    }
    this.sessions.set(key, instance);
    if (this.sessions.size > 3) {
      const [oldest, translator] = this.sessions.entries().next().value!;
      translator.destroy(); this.sessions.delete(oldest);
    }
    return instance;
  }
  private async run(texts: string[], pair: LanguagePair): Promise<string[]> {
    const key = (text: string) => `${pairKey(pair)}\0${text}`;
    const missing = [...new Set(texts)].filter(text => !this.cache.has(key(text)));
    if (missing.length) {
      const instance = await this.session(pair);
      try {
        const groups = await this.split(missing, pair.sourceLanguage);
        for (let i = 0; i < missing.length; i++) {
          const output: string[] = [];
          for (const part of groups[i]) {
            const translated = part.trim() ? await modelTask(() => instance.translate(part.trim()), { timeoutMs: this.timeoutMs }) : part;
            if (part.trim() && !translated.trim()) throw new Error('The translation engine returned empty text. Try again.');
            output.push(part.trim() ? withPadding(part, translated) : part);
          }
          const translated = output.join('');
          if (!translated.trim()) throw new Error('The translation engine returned empty text. Try again.');
          this.cache.set(key(missing[i]), translated);
        }
      } catch (cause) {
        this.sessions.delete(pairKey(pair)); instance.destroy(); throw cause;
      }
    }
    const result = texts.map(text => this.cache.get(key(text))!);
    while (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
}
