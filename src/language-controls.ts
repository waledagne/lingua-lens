import { LANGUAGES, pairKey, parsePair, type LanguagePair } from './shared';

export class LanguageControls {
  readonly source = document.getElementById('source-language') as HTMLSelectElement;
  readonly target = document.getElementById('target-language') as HTMLSelectElement;
  readonly apply = document.getElementById('apply-languages') as HTMLButtonElement;
  private swap = document.getElementById('swap-languages') as HTMLButtonElement;
  constructor(onChange: () => void) {
    for (const select of [this.source, this.target]) {
      for (const [code, name] of LANGUAGES) {
        const option = document.createElement('option'); option.value = code; option.textContent = name; select.append(option);
      }
      select.addEventListener('change', onChange);
    }
    this.swap.addEventListener('click', () => {
      const source = this.source.value; this.source.value = this.target.value; this.target.value = source; onChange();
    });
  }
  read(): LanguagePair { return parsePair({ sourceLanguage: this.source.value, targetLanguage: this.target.value }); }
  set(pair: LanguagePair): void { this.source.value = pair.sourceLanguage; this.target.value = pair.targetLanguage; }
  changed(pair: LanguagePair): boolean { try { return pairKey(this.read()) !== pairKey(pair); } catch { return true; } }
  disable(disabled: boolean): void { this.source.disabled = disabled; this.target.disabled = disabled; this.swap.disabled = disabled; }
}
