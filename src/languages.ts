export interface LanguagePair { sourceLanguage: string; targetLanguage: string }
export const DEFAULT_PAIR: LanguagePair = { sourceLanguage: 'pl', targetLanguage: 'en' };
// Chrome's documented language list; availability is checked for each chosen pair on the device.
export const LANGUAGES = [
  ['ar', 'Arabic', 'مرحبًا.'], ['bn', 'Bengali', 'নমস্কার।'], ['bg', 'Bulgarian', 'Здравейте.'],
  ['zh', 'Chinese (Simplified)', '你好。'], ['zh-Hant', 'Chinese (Traditional)', '你好。'],
  ['hr', 'Croatian', 'Pozdrav.'], ['cs', 'Czech', 'Dobrý den.'], ['da', 'Danish', 'Hej.'],
  ['nl', 'Dutch', 'Hallo.'], ['en', 'English', 'Hello.'], ['fi', 'Finnish', 'Hei.'],
  ['fr', 'French', 'Bonjour.'], ['de', 'German', 'Hallo.'], ['el', 'Greek', 'Γεια σας.'],
  ['he', 'Hebrew', 'שלום.'], ['hi', 'Hindi', 'नमस्ते।'], ['hu', 'Hungarian', 'Szia.'],
  ['id', 'Indonesian', 'Halo.'], ['it', 'Italian', 'Ciao.'], ['ja', 'Japanese', 'こんにちは。'],
  ['kn', 'Kannada', 'ನಮಸ್ಕಾರ.'], ['ko', 'Korean', '안녕하세요.'], ['lt', 'Lithuanian', 'Sveiki.'],
  ['mr', 'Marathi', 'नमस्कार.'], ['no', 'Norwegian', 'Hei.'], ['pl', 'Polish', 'Witaj.'],
  ['pt', 'Portuguese', 'Olá.'], ['ro', 'Romanian', 'Bună ziua.'], ['ru', 'Russian', 'Здравствуйте.'],
  ['sk', 'Slovak', 'Dobrý deň.'], ['sl', 'Slovenian', 'Živjo.'], ['es', 'Spanish', 'Hola.'],
  ['sv', 'Swedish', 'Hej.'], ['ta', 'Tamil', 'வணக்கம்.'], ['te', 'Telugu', 'నమస్కారం.'],
  ['th', 'Thai', 'สวัสดี'], ['tr', 'Turkish', 'Merhaba.'], ['uk', 'Ukrainian', 'Вітаю.'],
  ['vi', 'Vietnamese', 'Xin chào.'],
] as const;
export function parsePair(value: unknown): LanguagePair {
  const pair = value as Partial<LanguagePair> | null;
  if (!pair || !LANGUAGES.some(([code]) => code === pair.sourceLanguage) || !LANGUAGES.some(([code]) => code === pair.targetLanguage)) throw new Error('Choose a supported source and target language.');
  if (pair.sourceLanguage === pair.targetLanguage) throw new Error('Choose different source and target languages.');
  return { sourceLanguage: pair.sourceLanguage!, targetLanguage: pair.targetLanguage! };
}
export function pairKey(pair: LanguagePair): string { return `${pair.sourceLanguage}:${pair.targetLanguage}`; }
export function languageName(code: string): string { return LANGUAGES.find(([value]) => value === code)?.[1] ?? code; }
export function pairLabel(pair: LanguagePair): string { return `${languageName(pair.sourceLanguage)} → ${languageName(pair.targetLanguage)}`; }
export function sampleText(code: string): string { return LANGUAGES.find(([value]) => value === code)?.[2] ?? 'Hello.'; }
