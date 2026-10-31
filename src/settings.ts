import { DEFAULT_PAIR, LANGUAGES, pairKey, parsePair, type Settings, type SitePreference } from './shared';
export const SETTINGS_VERSION = 4;
function validSite(site: string): boolean {
  try { return new URL(`https://${site}`).hostname === site && !/[/*?#@\s]/u.test(site); } catch { return false; }
}
export function forSite(settings: Settings, site: string): Settings {
  const pair = settings.sitePreferences?.[site]?.pair ?? settings.pair;
  return { ...settings, pair, ready: pair.sourceLanguage === 'auto' ? settings.detectorReady : settings.preparedPairs.includes(pairKey(pair)) };
}
export function readSettings(stored: Record<string, unknown>): Settings {
  let pair = DEFAULT_PAIR;
  try { pair = parsePair(stored.pair); } catch { /* New installation or invalid stored preference. */ }
  // Adopt automatic detection on upgrade while retaining the user's target language.
  if (typeof stored.schemaVersion !== 'number' || stored.schemaVersion < 3) pair = { sourceLanguage: 'auto', targetLanguage: pair.targetLanguage };
  const validKeys = new Set(LANGUAGES.flatMap(([sourceLanguage]) => LANGUAGES.filter(([code]) => code !== sourceLanguage).map(([targetLanguage]) => pairKey({ sourceLanguage, targetLanguage }))));
  const preparedPairs = Array.isArray(stored.preparedPairs) ? [...new Set(stored.preparedPairs.filter((key): key is string => typeof key === 'string' && validKeys.has(key)))] :
    stored.schemaVersion === undefined && stored.ready === true ? ['pl:en'] : [];
  // Never implicitly enable a site; retain only preferences explicitly stored by the user.
  const autoSites = Array.isArray(stored.autoSites) ? [...new Set(stored.autoSites.filter((site): site is string => {
    if (typeof site !== 'string') return false;
    return validSite(site);
  }))] : [];
  const detectorReady = stored.detectorReady === true;
  const sitePreferences: Record<string, SitePreference> = Object.create(null) as Record<string, SitePreference>;
  if (stored.sitePreferences && typeof stored.sitePreferences === 'object' && !Array.isArray(stored.sitePreferences)) {
    for (const [site, value] of Object.entries(stored.sitePreferences)) {
      if (!validSite(site) || !value || typeof value !== 'object') continue;
      const candidate = value as SitePreference, preference: SitePreference = {};
      try { if (candidate.pair) preference.pair = parsePair(candidate.pair); } catch { /* Ignore invalid overrides. */ }
      if (candidate.never === true) preference.never = true;
      if (preference.pair || preference.never) sitePreferences[site] = preference;
    }
  }
  const understoodLanguages = Array.isArray(stored.understoodLanguages) ? [...new Set(stored.understoodLanguages.filter((code): code is string => LANGUAGES.some(([language]) => language === code)))] : [];
  return { pair, preparedPairs, detectorReady, autoSites: autoSites.filter(site => !sitePreferences[site]?.never), sitePreferences, understoodLanguages,
    ready: pair.sourceLanguage === 'auto' ? detectorReady : preparedPairs.includes(pairKey(pair)) };
}
export function storedSettings(settings: Settings): Record<string, unknown> {
  return { schemaVersion: SETTINGS_VERSION, pair: settings.pair, preparedPairs: settings.preparedPairs, detectorReady: settings.detectorReady, autoSites: settings.autoSites,
    sitePreferences: settings.sitePreferences ?? {}, understoodLanguages: settings.understoodLanguages ?? [] };
}
