import { errorMessage, MAX_BATCH, MAX_PASSAGE_CONTEXT, MAX_TEXT, type LanguagePair, type PassageTranslation, type SourceContext } from './shared';
import { validateContext } from './source-detector';
import { ModelTimeoutError } from './model-task';

export function validatePassages(texts: unknown, contexts: unknown): { texts: string[]; contexts: SourceContext[] } {
  if (!Array.isArray(texts) || !texts.length || texts.length > MAX_BATCH || !texts.every(text => typeof text === 'string' && text.length <= MAX_TEXT) ||
      texts.reduce((size, text) => size + text.length, 0) > 24000 || !Array.isArray(contexts) || contexts.length !== texts.length) throw new Error('Invalid passage batch.');
  const validated = contexts.map(validateContext);
  if (validated.some(context => context.sample.length > MAX_PASSAGE_CONTEXT)) throw new Error('Passage context is too long.');
  return { texts, contexts: validated };
}

/** Preserve originals when detection or a language group fails, allowing other groups to finish. */
export class PassageEngine {
  constructor(private detect: (context: SourceContext) => Promise<string>, private translate: (texts: string[], pair: LanguagePair) => Promise<string[]>) {}
  async run(texts: string[], contexts: SourceContext[], targetLanguage: string, understoodLanguages: string[]): Promise<PassageTranslation> {
    const result: PassageTranslation = { translations: [...texts], sources: texts.map(() => null), issues: texts.map(() => null) };
    const groups = new Map<string, number[]>(), detected = new Map<string, Promise<string>>();
    let detectorTimeout: ModelTimeoutError | undefined;
    for (let i = 0; i < texts.length; i++) {
      const context = contexts[i], key = context.pageLanguage + '\0' + context.sample;
      try {
        if (detectorTimeout) throw detectorTimeout;
        let detection = detected.get(key);
        if (!detection) { detection = this.detect(context); detected.set(key, detection); }
        const source = await detection;
        result.sources[i] = source;
        if (source === targetLanguage || understoodLanguages.includes(source)) continue;
        const group = groups.get(source) ?? []; group.push(i); groups.set(source, group);
      } catch (error) {
        // All passages use the same detector. One native hang must not turn
        // into a separate 45-second wait for every remaining context.
        if (error instanceof ModelTimeoutError) detectorTimeout = error;
        result.issues[i] = { sourceLanguage: null, message: errorMessage(error) };
      }
    }
    for (const [sourceLanguage, indexes] of groups) {
      try {
        const translated = await this.translate(indexes.map(index => texts[index]), { sourceLanguage, targetLanguage });
        if (translated.length !== indexes.length || translated.some(text => typeof text !== 'string' || !text.trim())) throw new Error('Chrome returned an incomplete translation for this language.');
        indexes.forEach((index, i) => { result.translations[index] = translated[i]; });
      } catch (error) {
        for (const index of indexes) result.issues[index] = { sourceLanguage, message: errorMessage(error) };
      }
    }
    return result;
  }
}
