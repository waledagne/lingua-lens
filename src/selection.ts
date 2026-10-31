/** Serialized by executeScript: keep this function independent of module bindings. */
export function readSelection(): { text: string; pageLanguage: string; focused: boolean } {
  const selection = window.getSelection();
  const blocked = 'input,textarea,[contenteditable]:not([contenteditable="false"]),[data-lingua-lens-ignore]';
  const editable = (node: Node | null): boolean => {
    const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
    if (!element) return false;
    if (element.closest(blocked)) return true;
    const root = element.getRootNode();
    return root instanceof ShadowRoot && editable(root.host);
  };
  const unsafeRange = !!selection && Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).some(range =>
    editable(range.startContainer) || editable(range.endContainer) ||
    Array.from(document.querySelectorAll(blocked)).some(element => range.intersectsNode(element)));
  return { text: !selection || unsafeRange || editable(document.activeElement) ? '' : selection.toString().trim(),
    pageLanguage: document.documentElement.lang, focused: document.hasFocus() };
}
