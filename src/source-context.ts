import type { SourceContext } from './shared';

// Self-contained: also serialized by chrome.scripting.executeScript() from the setup flow.
export function collectSourceContext(documentRoot: Document = document): SourceContext {
  const sample: string[] = [];
  const skip = 'script,style,noscript,template,textarea,input,code,pre,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[translate="no"]';
  const walker = documentRoot.createTreeWalker(documentRoot.body ?? documentRoot.documentElement, 4);
  let node: Node | null;
  let size = 0;
  while (size < 6000 && (node = walker.nextNode())) {
    if (node.parentElement?.closest(skip)) continue;
    const value = node.textContent?.replace(/\s+/gu, ' ').trim();
    if (!value || !/\p{L}/u.test(value)) continue;
    sample.push(value); size += value.length + 1;
  }
  return { sample: sample.join('\n').slice(0, 6000), pageLanguage: documentRoot.documentElement.lang.slice(0, 100) };
}
