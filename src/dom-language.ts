import { normalizeLanguage } from './source-detector';

export function languageFor(element: Element): string {
  let current: Element | null = element;
  while (current) {
    const declared = current.closest('[lang]');
    if (declared) return (declared.getAttribute('lang') ?? '').trim().slice(0, 100);
    const root = current.getRootNode();
    current = root instanceof element.ownerDocument.defaultView!.ShadowRoot ? root.host : null;
  }
  return element.ownerDocument.documentElement.lang.slice(0, 100);
}
export function languageKey(value: string): string { return normalizeLanguage(value) ?? value.toLowerCase(); }
export function explicitlyHidden(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.closest('[hidden],[aria-hidden="true"]')) return true;
    const root = current.getRootNode();
    current = root instanceof element.ownerDocument.defaultView!.ShadowRoot ? root.host : null;
  }
  return false;
}
