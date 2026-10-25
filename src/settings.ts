import { DEFAULT_PAIR, LANGUAGES, pairKey, parsePair, type Settings } from './shared';
export const SETTINGS_VERSION = 3;
export function readSettings(stored: Record<string, unknown>): Settings {
  let pair = DEFAULT_PAIR;
  try { pair = parsePair(stored.pair); } catch { /* New installation or invalid stored preference. */ }
  // Adopt automatic detection on upgrade while retaining the user's target language.
  if (stored.schemaVersion !== SETTINGS_VERSION) pair = { sourceLanguage: 'auto', targetLanguage: pair.targetLanguage };
  const validKeys = new Set(LANGUAGES.flatMap(([sourceLanguage]) => LANGUAGES.filter(([code]) => code !== sourceLanguage).map(([targetLanguage]) => pairKey({ sourceLanguage, targetLanguage }))));
  const preparedPairs = Array.isArray(stored.preparedPairs) ? [...new Set(stored.preparedPairs.filter((key): key is string => typeof key === 'string' && validKeys.has(key)))] :
    stored.schemaVersion === undefined && stored.ready === true ? ['pl:en'] : [];
  // Never implicitly enable a site; retain only preferences explicitly stored by the user.
  const autoSites = Array.isArray(stored.autoSites) ? [...new Set(stored.autoSites.filter((site): site is string => {
    if (typeof site !== 'string') return false;
    try { return new URL(`https://${site}`).hostname === site && !/[/*?#@\s]/u.test(site); } catch { return false; }
  }))] : [];
  const detectorReady = stored.detectorReady === true;
  return { pair, preparedPairs, detectorReady, autoSites, ready: pair.sourceLanguage === 'auto' ? detectorReady : preparedPairs.includes(pairKey(pair)) };
}
export function storedSettings(settings: Settings): Record<string, unknown> {
  return { schemaVersion: SETTINGS_VERSION, pair: settings.pair, preparedPairs: settings.preparedPairs, detectorReady: settings.detectorReady, autoSites: settings.autoSites };
}
