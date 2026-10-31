import { languageName, MAX_TEXT } from './shared';

export const READING_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';
const COMPLEX_CONTENT = 'div,section,article,ul,ol,table,button,input,select,textarea,iframe,canvas,svg,pre,code,[contenteditable]:not([contenteditable="false"]),[translate="no"],[role="button"],[role="textbox"]';
export interface ParagraphSnapshot { parts: { node: Node; value: string }[]; text: string }

/** Group prose across inline markup; keep its actual DOM and links intact. */
export function readingBlock(element: Element, eligible: (element: Element) => boolean): Element | null {
  const block = element.closest(READING_BLOCKS);
  if (!block || !eligible(block) || block.matches('[role="button"],[tabindex],[contenteditable]')) return null;
  if (Array.from(block.querySelectorAll(READING_BLOCKS + ',' + COMPLEX_CONTENT)).some(child => !child.closest('[data-lingua-lens-ignore]'))) return null;
  return block;
}
export function paragraphSnapshot(block: Element, eligible: (element: Element) => boolean): ParagraphSnapshot | null {
  const parts: ParagraphSnapshot['parts'] = [];
  let valid = true;
  const visit = (node: Node): void => {
    if (node.nodeType === 3) { parts.push({ node, value: (node as Text).data }); return; }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (element.hasAttribute('data-lingua-lens-ignore')) return;
      if (!eligible(element) || element.shadowRoot) { valid = false; return; }
      if (element.tagName === 'BR') { parts.push({ node, value: '\n' }); return; }
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of block.childNodes) visit(child);
  const text = parts.map(part => part.value).join('');
  return valid && text.length <= MAX_TEXT && /\p{L}/u.test(text) ? { parts, text } : null;
}
export function sameParagraph(left: ParagraphSnapshot, right: ParagraphSnapshot): boolean {
  return left.parts.length === right.parts.length && left.parts.every((part, i) => part.node === right.parts[i].node && part.value === right.parts[i].value);
}
export function renderParagraph(block: Element, text: string, targetLanguage: string): HTMLElement {
  const document = block.ownerDocument;
  const host = document.createElement('span');
  host.dataset.linguaLensIgnore = ''; host.dataset.linguaLensTranslation = ''; host.translate = false;
  host.style.cssText = 'display:block!important;margin-block:0.55em 0.25em!important;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{display:block}.reading{display:block;color:#204536;background:#edf4ed;border-inline-start:3px solid #47765b;border-radius:3px;padding:10px 12px;font:400 15px/1.65 system-ui,sans-serif;text-align:start;letter-spacing:normal}.label{display:block;font:500 10px/1.5 system-ui,sans-serif;color:#536b5b;margin-bottom:4px}.text{white-space:pre-wrap;overflow-wrap:anywhere}';
  const reading = document.createElement('span'); reading.className = 'reading'; reading.dir = 'auto';
  const label = document.createElement('span'); label.className = 'label'; label.textContent = targetLanguage ? 'Translation · ' + languageName(targetLanguage) : 'Translation';
  const result = document.createElement('span'); result.className = 'text'; result.dir = 'auto'; result.lang = targetLanguage; result.textContent = text;
  reading.append(label, result); root.append(style, reading); block.append(host);
  return host;
}
