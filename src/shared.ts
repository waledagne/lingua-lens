export const PAIR = { sourceLanguage: 'pl', targetLanguage: 'en' } as const;
export const DEFAULT_AUTO_SITES = ['allegro.pl'];
export const MAX_TEXT = 12000;
export const MAX_BATCH = 32;

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export interface Settings { ready: boolean; autoSites: string[] }
export interface PageStatus { enabled: boolean; translated: number; pending: number; error: string | null }
export interface TabState extends Settings { enabled: boolean; site: string; status: PageStatus | null }
export type BackgroundRequest =
  | { target: 'background'; type: 'state'; tabId?: number }
  | { target: 'background'; type: 'translate'; texts: string[] }
  | { target: 'background'; type: 'toggle'; tabId: number; enabled: boolean }
  | { target: 'background'; type: 'auto'; tabId: number; enabled: boolean }
  | { target: 'background'; type: 'ready' };
export type PageRequest = { target: 'page'; type: 'start' | 'stop' | 'status' | 'refresh' };

export function siteKey(url: string): string {
  const host = new URL(url).hostname;
  return host === 'allegro.pl' || host.endsWith('.allegro.pl') ? 'allegro.pl' : host;
}
export function originPattern(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Open a normal website first.');
  return `${parsed.protocol}//${parsed.hostname}/*`;
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
