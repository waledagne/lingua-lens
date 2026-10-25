import { DEFAULT_PAIR, LANGUAGES, pairKey, parsePair, type Settings } from './shared';
export const SETTINGS_VERSION = 2;
export function readSettings(stored: Record<string, unknown>): Settings {
  let pair = DEFAULT_PAIR;
  try { pair = parsePair(stored.pair); } catch { /* New installation or invalid stored preference. */ }
  const validKeys = new Set(LANGUAGES.flatMap(([sourceLanguage]) => LANGUAGES.filter(([code]) => code !== sourceLanguage).map(([targetLanguage]) => pairKey({ sourceLanguage, targetLanguage }))));
  const preparedPairs = Array.isArray(stored.preparedPairs) ? [...new Set(stored.preparedPairs.filter((key): key is string => typeof key === 'string' && validKeys.has(key)))] :
    stored.schemaVersion !== SETTINGS_VERSION && stored.ready === true ? [pairKey(DEFAULT_PAIR)] : [];
  // Never implicitly enable a site; retain only preferences explicitly stored by the user.
  const autoSites = Array.isArray(stored.autoSites) ? [...new Set(stored.autoSites.filter((site): site is string => {
    if (typeof site !== 'string') return false;
    try { return new URL(`https://${site}`).hostname === site && !/[/*?#@\s]/u.test(site); } catch { return false; }
  }))] : [];
  return { pair, preparedPairs, autoSites, ready: preparedPairs.includes(pairKey(pair)) };
}
export function storedSettings(settings: Settings): Record<string, unknown> {
  return { schemaVersion: SETTINGS_VERSION, pair: settings.pair, preparedPairs: settings.preparedPairs, autoSites: settings.autoSites };
}
