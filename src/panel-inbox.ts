import type { PanelSelection } from './shared';

/** One short-lived handoff per window. Drafts are never written to extension storage. */
export class PanelInbox {
  private selections = new Map<number, { value: PanelSelection; time: number }>();
  put(windowId: number, value: PanelSelection, now = Date.now()): void { this.selections.set(windowId, { value, time: now }); }
  take(windowId: number, now = Date.now()): PanelSelection | null {
    const entry = this.selections.get(windowId); this.selections.delete(windowId);
    return entry && now - entry.time <= 60000 ? entry.value : null;
  }
  clear(windowId: number): void { this.selections.delete(windowId); }
}
