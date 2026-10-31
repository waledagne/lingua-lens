import { MAX_PASSAGE_CONTEXT, type SourceContext } from './shared';
import { READING_BLOCKS } from './paragraph';
import { explicitlyHidden, languageFor, languageKey } from './dom-language';

export function passageContext(element: Element, original: string, eligible: (element: Element) => boolean, originalText: (node: Text) => string): SourceContext {
  const pageLanguage = languageFor(element);
  if (explicitlyHidden(element)) return { sample: '', pageLanguage };
  let region = element.closest(READING_BLOCKS) ?? element;
  const declaration = element.closest('[lang]');
  if (declaration && region.contains(declaration)) region = declaration;
  const sample: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(region, 4);
  let node: Node | null, size = 0;
  while (size < MAX_PASSAGE_CONTEXT && (node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || !eligible(parent) || explicitlyHidden(parent) || languageKey(languageFor(parent)) !== languageKey(pageLanguage)) continue;
    const text = originalText(node as Text);
    sample.push(text); size += text.length;
  }
  return { sample: (sample.join('') || original).slice(0, MAX_PASSAGE_CONTEXT), pageLanguage };
}
