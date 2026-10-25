import type { LanguagePair } from './languages';
export * from './languages';
export const MAX_TEXT = 12000;
export const MAX_BATCH = 32;

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export interface SourceContext { sample: string; pageLanguage: string }
export interface Settings { pair: LanguagePair; preparedPairs: string[]; detectorReady: boolean; ready: boolean; autoSites: string[] }
export interface PageStatus { enabled: boolean; translated: number; pending: number; error: string | null; detectedSource?: string | null }
export interface TabState extends Settings { enabled: boolean; site: string; status: PageStatus | null }
export type BackgroundRequest =
  | { target: 'background'; type: 'state'; tabId?: number }
  | { target: 'background'; type: 'translate'; texts: string[]; pair: LanguagePair; sourceLanguage?: string }
  | { target: 'background'; type: 'detect'; context: SourceContext; pair: LanguagePair }
  | { target: 'background'; type: 'source-context'; tabId: number }
  | { target: 'background'; type: 'languages'; pair: LanguagePair }
  | { target: 'background'; type: 'toggle'; tabId: number; enabled: boolean }
  | { target: 'background'; type: 'auto'; tabId: number; enabled: boolean }
  | { target: 'background'; type: 'ready'; pair: LanguagePair; detectedSource?: string };
export type PageRequest = { target: 'page'; type: 'status' | 'refresh' };

export function siteKey(url: string): string {
  return new URL(url).hostname;
}
export function isWebsite(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname !== 'chromewebstore.google.com' &&
      !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
  } catch { return false; }
}
export function originPattern(url: string): string {
  if (!isWebsite(url)) throw new Error('Open a normal website first. Chrome protects this page from extensions.');
  return `*://${siteKey(url)}/*`;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function unwrap<T>(reply: Reply<T> | undefined): T {
  if (!reply) throw new Error('The extension did not respond. Reload it and refresh this page.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
export async function request<T>(message: BackgroundRequest): Promise<T> {
  return unwrap<T>(await chrome.runtime.sendMessage(message));
}
export function withPadding(original: string, translated: string): string {
  const leading = original.match(/^\s*/u)?.[0] ?? '';
  const trailing = original.match(/\s*$/u)?.[0] ?? '';
  return leading + translated.trim() + trailing;
}
