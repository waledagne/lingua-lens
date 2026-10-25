import { errorMessage, MAX_BATCH, MAX_TEXT, withPadding, type PageStatus } from './shared';

type Translate = (texts: string[]) => Promise<string[]>;
interface Entry { node: Text | Element; attribute?: string; original: string; translated?: string }
const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];
const SKIP = 'script,style,noscript,template,textarea,code,pre,kbd,samp,[contenteditable]:not([contenteditable="false"]),[translate="no"],[data-lingua-lens-ignore]';

export class DomTranslator {
  private enabled = false;
  private generation = 0;
  private entries = new Set<Entry>();
  private index = new WeakMap<Node, Map<string, Entry>>();
  private pending = new Set<Entry>();
  private observers = new Map<Document | ShadowRoot, MutationObserver>();
  private timer?: ReturnType<typeof setTimeout>;
  private discovery?: ReturnType<typeof setInterval>;
  private flushing = false;
  private suspended = false;
  private error: string | null = null;
  private interaction = () => this.scheduleDiscovery();
  private discoveryTimer?: ReturnType<typeof setTimeout>;

  constructor(private document: Document, private translate: Translate, private delay = 80) {}
  status(): PageStatus {
    return {
      enabled: this.enabled,
      translated: [...this.entries].filter(entry => entry.node.isConnected && entry.translated !== undefined && entry.translated !== entry.original).length,
      pending: this.pending.size, error: this.error,
    };
  }
  start(): void {
    this.suspended = false; this.error = null;
    if (!this.enabled) {
      this.enabled = true; this.generation++;
      this.observe(this.document);
      this.document.addEventListener('click', this.interaction, true);
      this.document.addEventListener('focusin', this.interaction, true);
      // attachShadow() on an existing host does not generate a DOM mutation.
      // Discover those roots without re-translating the entire normal DOM.
      this.discovery = setInterval(() => { this.discover(); this.prune(); }, 2500);
    }
    this.scan(this.document);
    this.schedule();
  }
  stop(): void {
    this.enabled = false; this.generation++;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear(); clearTimeout(this.timer); clearTimeout(this.discoveryTimer); clearInterval(this.discovery);
    this.timer = undefined;
    this.document.removeEventListener('click', this.interaction, true);
    this.document.removeEventListener('focusin', this.interaction, true);
    for (const entry of this.entries) {
      // Never restore over a newer value supplied by the website.
      if (entry.node.isConnected && entry.translated !== undefined && this.read(entry) === entry.translated) this.write(entry, entry.original);
    }
    this.entries.clear(); this.pending.clear(); this.index = new WeakMap(); this.error = null;
  }
  private read(entry: Entry): string {
    return entry.attribute ? (entry.node as Element).getAttribute(entry.attribute) ?? '' : (entry.node as Text).data;
  }
  private write(entry: Entry, value: string): void {
    if (entry.attribute) (entry.node as Element).setAttribute(entry.attribute, value);
    else (entry.node as Text).data = value;
  }
  private eligible(element: Element): boolean {
    if (element.closest(SKIP)) return false;
    // closest() stops at a shadow boundary; inspect its host too.
    const root = element.getRootNode();
    if (root instanceof this.document.defaultView!.ShadowRoot && !this.eligible(root.host)) return false;
    if (element.matches('input[type="password"],input[type="hidden"]')) return false;
    // An option without value uses its text as submitted data.
    if (element.closest('option:not([value])')) return false;
    return true;
  }
  private collect(node: Text | Element, attribute?: string): void {
    const element = node.nodeType === 3 ? node.parentElement : node as Element;
    if (!element || !this.eligible(element)) return;
    const current = attribute ? element.getAttribute(attribute) ?? '' : (node as Text).data;
    const trimmed = current.trim();
    if (!trimmed || !/\p{L}/u.test(trimmed) || current.length > MAX_TEXT) return;
    const key = attribute ?? '#text';
    let byKey = this.index.get(node);
    if (!byKey) { byKey = new Map(); this.index.set(node, byKey); }
    let entry = byKey.get(key);
    if (entry?.translated === current) return;
    if (!entry) { entry = { node, attribute, original: current }; byKey.set(key, entry); this.entries.add(entry); }
    else if (entry.original !== current) { entry.original = current; entry.translated = undefined; }
    this.pending.add(entry);
  }
  private scan(root: Node): void {
    if (!this.enabled || !root.isConnected) return;
    if (root.nodeType === 3) { this.collect(root as Text); return; }
    if (root.nodeType === 1) {
      const element = root as Element;
      if (!this.eligible(element)) return;
      for (const attribute of ATTRIBUTES) if (element.hasAttribute(attribute)) this.collect(element, attribute);
      this.shadow(element);
    }
    const walker = this.document.createTreeWalker(root, 1 | 4, {
      acceptNode: node => {
        const element = node.nodeType === 1 ? node as Element : node.parentElement;
        return element && this.eligible(element) ? 1 : 2;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) this.collect(node as Text);
      else {
        const element = node as Element;
        for (const attribute of ATTRIBUTES) if (element.hasAttribute(attribute)) this.collect(element, attribute);
        this.shadow(element);
      }
    }
  }
  private shadow(element: Element): void {
    if (element.shadowRoot && !this.observers.has(element.shadowRoot) && this.eligible(element)) {
      this.observe(element.shadowRoot); this.scan(element.shadowRoot);
    }
  }
  private observe(root: Document | ShadowRoot): void {
    const observer = new this.document.defaultView!.MutationObserver(records => {
      if (!this.enabled) return;
      const before = this.pending;
      this.pending = new Set();
      for (const record of records) {
        if (record.type === 'characterData') this.collect(record.target as Text);
        else if (record.type === 'attributes') {
          const element = record.target as Element;
          if (ATTRIBUTES.includes(record.attributeName!)) this.collect(element, record.attributeName!);
          else this.scan(element);
        } else for (const node of record.addedNodes) this.scan(node);
      }
      // New dialogs take priority over the initial page backlog.
      for (const entry of before) this.pending.add(entry);
      this.prune(); this.schedule();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES, 'hidden', 'open', 'contenteditable', 'translate'] });
    this.observers.set(root, observer);
  }
  private scheduleDiscovery(): void {
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = setTimeout(() => { this.discover(); this.schedule(); }, 50);
  }
  private discover(): void {
    if (!this.enabled) return;
    for (const root of this.observers.keys()) {
      if (!root.isConnected) continue;
      for (const element of root.querySelectorAll('*')) this.shadow(element);
    }
    this.schedule();
  }
  private prune(): void {
    for (const entry of this.entries) {
      if (!entry.node.isConnected) { this.entries.delete(entry); this.pending.delete(entry); this.index.delete(entry.node); }
    }
    for (const [root, observer] of this.observers) {
      if (!root.isConnected) { observer.disconnect(); this.observers.delete(root); }
    }
  }
  private schedule(): void {
    if (!this.enabled || this.flushing || this.timer || this.suspended || !this.pending.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.delay);
  }
  private async flush(): Promise<void> {
    if (!this.enabled || this.flushing || this.suspended) return;
    this.flushing = true;
    const generation = this.generation;
    const batch: { entry: Entry; source: string }[] = [];
    const unique = new Set<string>();
    let total = 0;
    for (const entry of this.pending) {
      if (!entry.node.isConnected) { this.pending.delete(entry); continue; }
      const source = this.read(entry);
      const element = entry.node.nodeType === 3 ? entry.node.parentElement : entry.node as Element;
      if (!element || !this.eligible(element) || source !== entry.original) { this.pending.delete(entry); continue; }
      const text = source.trim();
      if (!unique.has(text) && (unique.size >= MAX_BATCH || total + text.length > 24000)) break;
      if (!unique.has(text)) total += text.length;
      unique.add(text); batch.push({ entry, source }); this.pending.delete(entry);
    }
    try {
      if (!batch.length) return;
      const texts = [...unique];
      const translations = await this.translate(texts);
      if (translations.length !== texts.length || translations.some(text => typeof text !== 'string' || !text.trim())) throw new Error('The translation engine returned an incomplete result.');
      if (!this.enabled || generation !== this.generation) return;
      const lookup = new Map(texts.map((text, i) => [text, translations[i]]));
      for (const { entry, source } of batch) {
        const element = entry.node.nodeType === 3 ? entry.node.parentElement : entry.node as Element;
        if (!this.entries.has(entry) || !entry.node.isConnected || this.read(entry) !== source || !element || !this.eligible(element)) continue;
        entry.translated = withPadding(source, lookup.get(source.trim())!);
        this.write(entry, entry.translated);
      }
      this.error = null;
    } catch (error) {
      if (this.enabled && generation === this.generation) {
        this.error = errorMessage(error); this.suspended = true;
        for (const { entry } of batch) if (entry.node.isConnected) this.pending.add(entry);
      }
    } finally {
      this.flushing = false; this.prune(); this.schedule();
    }
  }
}
