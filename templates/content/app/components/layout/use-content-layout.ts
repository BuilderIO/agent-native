import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  CONTENT_TEXT_MIN_WIDTH,
  type ContentLayout,
  type ContentLayoutInput,
  contentAvailableWidth,
  resolveContentLayout,
  sameContentLayout,
} from "./content-layout";

export const ContentLayoutContext = createContext<ContentLayout | null>(null);

/** The app shell's layout, or null outside the app shell. */
export function useContentLayout() {
  return useContext(ContentLayoutContext);
}

type AgentPanelDock = ContentLayoutInput["agentPanel"];
type ShellMeasurements = Omit<ContentLayoutInput, "previous">;

const CLOSED_AGENT_PANEL: AgentPanelDock = { open: false, width: 0 };

function pixels(value: string) {
  const width = Number.parseFloat(value);
  return Number.isFinite(width) ? width : null;
}

function agentPanelElements(shell: Element) {
  return Array.from(shell.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      (child.classList.contains("agent-sidebar-panel") ||
        child.hasAttribute("data-agent-sidebar-placeholder")),
  );
}

// The page settles on where the agent panel ends up: its inline
// `--agent-sidebar-width`, or the wide drawer's placeholder. Its drawn width
// animates for 260ms after it opens or closes.
export function readAgentPanelDock(shell: Element | null): AgentPanelDock {
  if (!shell) return CLOSED_AGENT_PANEL;
  const elements = agentPanelElements(shell);
  const placeholder = elements.find((element) =>
    element.hasAttribute("data-agent-sidebar-placeholder"),
  );
  if (placeholder) {
    return {
      open: true,
      width:
        pixels(placeholder.style.width) ??
        placeholder.getBoundingClientRect().width,
    };
  }
  const panel = elements.find((element) =>
    element.classList.contains("agent-sidebar-panel"),
  );
  if (panel?.dataset.agentSidebarState !== "open") return CLOSED_AGENT_PANEL;
  return {
    open: true,
    width:
      pixels(panel.style.getPropertyValue("--agent-sidebar-width")) ??
      panel.getBoundingClientRect().width,
  };
}

/**
 * Resolves the shell layout from the window, the saved sidebar preference,
 * and the agent panel inside `shellRef`. It re-renders only when a mode
 * changes, not on every frame of a window resize.
 */
export function useContentShellLayout({
  shellRef,
  sidebar,
}: {
  shellRef: RefObject<HTMLElement | null>;
  sidebar: ContentLayoutInput["sidebar"];
}) {
  const measurementsRef = useRef<ShellMeasurements>({
    // The shell renders only in the browser; a server render gets the widest
    // layout, as it did before the shell measured anything.
    viewportWidth: typeof window === "undefined" ? Infinity : window.innerWidth,
    sidebar,
    agentPanel: CLOSED_AGENT_PANEL,
  });
  const [layout, setLayout] = useState(() =>
    resolveContentLayout(measurementsRef.current),
  );
  const layoutRef = useRef(layout);

  const measure = useCallback((next: Partial<ShellMeasurements>) => {
    measurementsRef.current = { ...measurementsRef.current, ...next };
    const resolved = resolveContentLayout({
      ...measurementsRef.current,
      previous: layoutRef.current,
    });
    if (sameContentLayout(resolved, layoutRef.current)) return;
    layoutRef.current = resolved;
    setLayout(resolved);
  }, []);

  useLayoutEffect(() => {
    measure({
      sidebar: { collapsed: sidebar.collapsed, width: sidebar.width },
    });
  }, [measure, sidebar.collapsed, sidebar.width]);

  useLayoutEffect(() => {
    const onResize = () => measure({ viewportWidth: window.innerWidth });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  useLayoutEffect(() => {
    const shell = Array.from(shellRef.current?.children ?? []).find((child) =>
      child.classList.contains("agent-sidebar-shell"),
    );
    if (!shell) return;
    const read = () => measure({ agentPanel: readAgentPanelDock(shell) });
    const panelObserver = new MutationObserver(read);
    const watch = () => {
      panelObserver.disconnect();
      for (const element of agentPanelElements(shell)) {
        panelObserver.observe(element, {
          attributes: true,
          attributeFilter: [
            "style",
            "data-agent-sidebar-state",
            "data-agent-sidebar-layout",
          ],
        });
      }
      read();
    };
    const shellObserver = new MutationObserver(watch);
    shellObserver.observe(shell, { childList: true });
    watch();
    return () => {
      shellObserver.disconnect();
      panelObserver.disconnect();
    };
  }, [measure, shellRef]);

  /** The widest the sidebar can be dragged and still stay docked. */
  const dockedSidebarMaxWidth = useCallback(
    () =>
      contentAvailableWidth(measurementsRef.current) - CONTENT_TEXT_MIN_WIDTH,
    [],
  );
  /** Whether expanding the sidebar would dock it, rather than need a drawer. */
  const canDockSidebar = useCallback(
    () =>
      resolveContentLayout({
        ...measurementsRef.current,
        sidebar: { ...measurementsRef.current.sidebar, collapsed: false },
      }).sidebar === "docked",
    [],
  );

  return { layout, dockedSidebarMaxWidth, canDockSidebar };
}
