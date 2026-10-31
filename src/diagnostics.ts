import { detectorAPI, translatorAPI } from './translator-api';
import { MODEL_CHECK_MS, modelTask } from './model-task';
import { errorMessage, type LanguagePair } from './shared';

export async function diagnostics(pair: LanguagePair, prepared: { detectorReady: boolean; preparedPairs: string[] }, timeoutMs = MODEL_CHECK_MS): Promise<string> {
  const check = async (get: () => Promise<string>) => {
    try { return await modelTask(get, { timeoutMs }); } catch (cause) { return errorMessage(cause); }
  };
  const [detector, translator] = await Promise.all([
    check(() => detectorAPI().availability()),
    pair.sourceLanguage === 'auto' ? Promise.resolve('Choose a manual source to check a specific pair.') : check(() => translatorAPI().availability(pair)),
  ]);
  return JSON.stringify({
    extension: 'Lingua Lens', version: chrome.runtime.getManifest().version, capturedAt: new Date().toISOString(),
    browser: navigator.userAgent, platform: navigator.platform,
    languages: pair, nativeModels: { detector, translator },
    prepared: { detector: prepared.detectorReady, selectedPair: prepared.preparedPairs.includes(pair.sourceLanguage + ':' + pair.targetLanguage) },
  }, null, 2);
}
