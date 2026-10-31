import type { SelectionView } from './shared';

export class SelectionPanel {
  private host?: HTMLDivElement;
  private id?: string;
  private previousFocus?: HTMLElement;
  private closeKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } };
  constructor(private document: Document, private openSetup: () => Promise<unknown>) {}
  close(): void {
    const hadFocus = !!this.host?.shadowRoot?.activeElement;
    this.host?.remove(); this.host = undefined; this.id = undefined;
    this.document.removeEventListener('keydown', this.closeKey, true);
    if (hadFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.previousFocus = undefined;
  }
  show(view: SelectionView): void {
    // Closing a pending request must also dismiss its eventual result.
    if ((view.result !== undefined || view.error) && view.id !== this.id) return;
    if (!this.host) {
      this.previousFocus = this.document.activeElement as HTMLElement;
      this.host = this.document.createElement('div');
      this.host.dataset.linguaLensIgnore = ''; this.host.translate = false;
      this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:auto 20px 20px auto!important;width:min(400px,calc(100vw - 40px))!important;z-index:2147483647!important;color-scheme:light!important;';
      this.host.attachShadow({ mode: 'open' }); this.document.documentElement.append(this.host);
      this.document.addEventListener('keydown', this.closeKey, true);
    }
    const initial = this.id !== view.id;
    this.id = view.id;
    const root = this.host.shadowRoot!;
    const hadFocus = !!root.activeElement;
    root.replaceChildren();
    const style = this.document.createElement('style');
    style.textContent = '*{box-sizing:border-box}section{font:14px system-ui,sans-serif;color:#20342f;direction:ltr;text-align:left;background:#fff;border:1px solid #dce4dc;border-radius:16px;box-shadow:0 12px 50px #1233;padding:20px;max-height:70vh;overflow:auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:16px;margin:0}small{color:#53665d}p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;font-size:14px;margin:8px 0 16px}button,a{font:inherit;cursor:pointer}button{background:#edf3e9;border:1px solid #bccdbf;border-radius:7px;padding:7px 12px;color:#245747}button:disabled{opacity:.5}button:focus-visible,a:focus-visible{outline:3px solid #487b61;outline-offset:3px}.error{color:#943b2a}footer{display:flex;justify-content:space-between;align-items:center;gap:12px}a{color:#245747}';
    const card = this.document.createElement('section'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Selected text translation');
    const header = this.document.createElement('header'), title = this.document.createElement('h2'); title.textContent = 'Lingua Lens';
    const close = this.document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Close translation'); close.addEventListener('click', () => this.close()); header.append(title, close);
    const label = this.document.createElement('p'); label.textContent = view.label;
    const originalLabel = this.document.createElement('small'); originalLabel.textContent = 'Original';
    const original = this.document.createElement('p'); original.dir = 'auto'; original.textContent = view.original;
    const resultLabel = this.document.createElement('small'); resultLabel.textContent = 'Translation';
    const result = this.document.createElement('p'); result.dir = 'auto'; result.setAttribute('role', view.error ? 'alert' : 'status'); result.setAttribute('aria-live', 'polite');
    result.textContent = view.error ?? view.result ?? 'Translating on your device…'; result.className = view.error ? 'error' : ''; result.id = 'selection-result';
    const footer = this.document.createElement('footer'), copy = this.document.createElement('button'); copy.textContent = 'Copy translation'; copy.disabled = view.result === undefined;
    copy.addEventListener('click', async () => {
      try { await this.document.defaultView!.navigator.clipboard.writeText(view.result ?? ''); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Select the translation to copy it.'; }
    });
    const setup = this.document.createElement('button'); setup.textContent = view.error ? 'Open language setup' : 'Language settings';
    setup.addEventListener('click', () => { void this.openSetup().catch(() => { setup.textContent = 'Open setup from the toolbar'; }); });
    footer.append(copy, setup); card.append(header, label, originalLabel, original, resultLabel, result, footer); root.append(style, card);
    if (initial || hadFocus) close.focus({ preventScroll: true });
  }
}
