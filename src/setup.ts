import { errorMessage, PAIR, request } from './shared';
import { translatorAPI } from './translator-api';

const prepare = document.getElementById('prepare') as HTMLButtonElement;
const progress = document.getElementById('progress') as HTMLProgressElement;
const status = document.getElementById('setup-status')!;
const errorBox = document.getElementById('setup-error')!;
prepare.disabled = true;
void (async () => {
  try {
    const availability = await translatorAPI().availability(PAIR);
    if (availability === 'unavailable') throw new Error('Chrome cannot provide Polish → English on this device. Update Chrome and check available disk space.');
    prepare.disabled = false;
    prepare.textContent = availability === 'available' ? 'Enable & test translation' : 'Download & enable translation';
    status.textContent = availability === 'available' ? 'Language packs are available. Run a quick translation to finish setup.' : 'Your Chrome supports local translation. Keep this tab open during the download.';
  } catch (error) {
    status.textContent = 'Local translation is not ready.'; errorBox.textContent = errorMessage(error); errorBox.hidden = false;
  }
})();
prepare.addEventListener('click', async () => {
  prepare.disabled = true; errorBox.hidden = true; progress.hidden = false;
  status.textContent = 'Preparing translation… Keep this tab open.';
  try {
    // create() is called directly from the click so Chrome can authorize its first download.
    const instance = await translatorAPI().create({ ...PAIR, monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => {
        progress.value = event.loaded;
        status.textContent = `Downloading language packs… ${Math.round(event.loaded * 100)}%`;
      });
    } });
    try {
      const sample = await instance.translate('Twój koszyk jest pusty.');
      if (!sample.trim()) throw new Error('Chrome returned an empty translation. Please try again.');
      document.getElementById('sample-result')!.textContent = sample;
      document.getElementById('sample')!.hidden = false;
      await request({ target: 'background', type: 'ready' });
    } finally { instance.destroy(); }
    progress.value = 1; prepare.textContent = 'Translation is ready';
    status.textContent = 'All set. Refresh Allegro to start, then try opening a menu or dialog.';
  } catch (error) {
    prepare.disabled = false; prepare.textContent = 'Try setup again';
    progress.hidden = true; status.textContent = 'Setup did not finish.';
    errorBox.textContent = errorMessage(error); errorBox.hidden = false;
  }
});
