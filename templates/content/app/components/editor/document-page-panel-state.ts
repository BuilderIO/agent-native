import {
  getAgentSidebarState,
  SIDEBAR_STATE_CHANGE_EVENT,
} from "@agent-native/core/client/agent-chat";
import { isAgentSidebarToggleShortcut } from "@agent-native/toolkit/app/chat/agent-sidebar-events";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type DocumentPagePanelTab = "agent" | "comments" | "info";

// The margin comments fade first, then the panel slides. Closing runs the
// other way, so the margin comes back once the panel has gone.
export const PAGE_PANEL_MARGIN_FADE_MS = 80;
export const PAGE_PANEL_SLIDE_MS = 220;
const PAGE_PANEL_PHONE_SLIDE_MS = 260;

function subscribeToAgentPanel(onChange: () => void) {
  window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, onChange);
}

/** The shell's agent: `open` anywhere, `inPanel` when it draws in a page panel. */
export function useAgentPanelState() {
  const state = useSyncExternalStore(
    subscribeToAgentPanel,
    getAgentSidebarState,
    () => null,
  );
  const open = state?.open ?? false;
  return { open, inPanel: open && state?.hosted === true };
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Sequences the panel against the margin comments. `requested` changes at
 * once, for the tab's own state; `tab` is the panel on screen, which waits for
 * a margin to fade. `rendered` outlasts `tab` for as long as the panel takes
 * to slide away, and `closing` holds the margin back until then.
 */
export function usePagePanelMotion(
  requested: DocumentPagePanelTab | null,
  marginOnScreen: boolean,
) {
  const [opened, setOpened] = useState(Boolean(requested));
  const [gone, setGone] = useState(!requested);
  const marginFading =
    Boolean(requested) && !opened && marginOnScreen && !prefersReducedMotion();
  const tab = marginFading ? null : requested;

  useEffect(() => {
    if (requested) {
      setGone(false);
      if (!marginFading) {
        setOpened(true);
        return;
      }
      const timer = window.setTimeout(
        () => setOpened(true),
        PAGE_PANEL_MARGIN_FADE_MS,
      );
      return () => window.clearTimeout(timer);
    }
    setOpened(false);
    if (prefersReducedMotion()) {
      setGone(true);
      return;
    }
    const timer = window.setTimeout(
      () => setGone(true),
      PAGE_PANEL_PHONE_SLIDE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [marginFading, requested]);

  const lastTab = useRef(tab);
  if (tab) lastTab.current = tab;
  return {
    tab,
    rendered: tab ?? (gone ? null : lastTab.current),
    closing: !requested && !gone,
    marginFading,
  };
}

type PanelShortcut = DocumentPagePanelTab | "last";

const PANEL_SHORTCUT_LETTERS: Record<string, DocumentPagePanelTab> = {
  j: "agent",
  m: "comments",
  i: "info",
};
const PANEL_SHORTCUT_CODES: Record<string, DocumentPagePanelTab> = {
  KeyJ: "agent",
  KeyM: "comments",
  KeyI: "info",
};

/**
 * The panel a key opens. The letter decides, so M stays M on AZERTY; a layout
 * whose keys type no Latin letter falls back to where the key sits. AltGr
 * reports as Ctrl+Alt, so anything with Alt is typing, not a shortcut.
 */
export function pagePanelShortcut(event: KeyboardEvent): PanelShortcut | null {
  if (isAgentSidebarToggleShortcut(event)) return "last";
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) {
    return null;
  }
  const letter = event.key.toLowerCase();
  return letter.charCodeAt(0) < 128
    ? (PANEL_SHORTCUT_LETTERS[letter] ?? null)
    : (PANEL_SHORTCUT_CODES[event.code] ?? null);
}

function isInAgentComposer(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest('[data-document-panel-agent] [contenteditable="true"]')
  );
}

/**
 * Calls `onShortcut` for a panel key that nothing on the page has handled.
 * ⇧⌘I goes first: TipTap's italic also answers it, in every editor on the page.
 */
export function usePagePanelShortcuts(
  enabled: boolean,
  onShortcut: (shortcut: PanelShortcut, event: KeyboardEvent) => void,
) {
  const onShortcutRef = useRef(onShortcut);
  useEffect(() => {
    onShortcutRef.current = onShortcut;
  });
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // ⇧⌘M on selected text has already started a comment.
      if (event.defaultPrevented) return;
      const shortcut = pagePanelShortcut(event);
      // The agent's box keeps ⇧⌘M for dictation, as its mic button says.
      if (shortcut === "comments" && isInAgentComposer(event.target)) return;
      if (shortcut) onShortcutRef.current(shortcut, event);
    };
    const handleKeyDownFirst = (event: KeyboardEvent) => {
      if (pagePanelShortcut(event) === "info") handleKeyDown(event);
    };
    document.addEventListener("keydown", handleKeyDownFirst, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDownFirst, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);
}

// Radix hands Escape to the top layer, which marks the key handled. A tab's
// tooltip is no layer to close first, and the row preview around a page closes
// after its panel: the panel still takes this press.
const escapesLeftToPanel = new WeakSet<Event>();

export function leaveEscapeToPagePanel(event: Event) {
  escapesLeftToPanel.add(event);
}

export function escapeWasHandled(event: KeyboardEvent) {
  return event.defaultPrevented && !escapesLeftToPanel.has(event);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

export function firstFocusableIn(root: HTMLElement | null) {
  return root?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
}
