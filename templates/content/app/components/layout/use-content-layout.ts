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
  type ContentLayout,
  type ContentLayoutInput,
  contentAvailableWidth,
  contentPageMinWidth,
  resolveContentLayout,
  sameContentLayout,
} from "./content-layout";

export const ContentLayoutContext = createContext<ContentLayout | null>(null);

/** Holds the shell's room for a page rail open; the returned call releases it. */
export const ContentUtilityRailContext = createContext<
  (() => () => void) | null
>(null);

/** The app shell's layout, or null outside the app shell. */
export function useContentLayout() {
  return useContext(ContentLayoutContext);
}

/**
 * Tells the shell this page has its comments list or Info open, so the
 * sidebar makes room for that rail before it covers the text.
 */
export function useContentUtilityRail(open: boolean) {
  const hold = useContext(ContentUtilityRailContext);
  useLayoutEffect(() => (open && hold ? hold() : undefined), [hold, open]);
}

type AgentPanelDock = ContentLayoutInput["agentPanel"];
type ShellMeasurements = Omit<ContentLayoutInput, "previous">;

const CLOSED_AGENT_PANEL: AgentPanelDock = { open: false, width: 0 };
// The fallback release waits this much past the panel's close transition, in
// case its `transitionend` never arrives.
const AGENT_PANEL_CLOSE_SLACK_MS = 50;

function pixels(value: string) {
  const width = Number.parseFloat(value);
  return Number.isFinite(width) ? width : null;
}

function milliseconds(time: string) {
  const value = Number.parseFloat(time);
  // A DOM that computes no transition times, like a test DOM, animates none.
  if (!Number.isFinite(value)) return 0;
  return time.trim().endsWith("ms") ? value : value * 1000;
}

// How long the panel remains in motion after a style change, from its computed
// transition: 0 when reduced motion or a non-animating layout turns it off.
function panelTransitionMs(element: Element) {
  const style = getComputedStyle(element);
  const durations = style.transitionDuration.split(",");
  const delays = style.transitionDelay.split(",");
  return Math.max(
    0,
    ...style.transitionProperty
      .split(",")
      .map((property, index) =>
        ["width", "transform", "all"].includes(property.trim())
          ? milliseconds(durations[index % durations.length]) +
            milliseconds(delays[index % delays.length])
          : 0,
      ),
  );
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
// `--agent-sidebar-width`, or the wide drawer's placeholder, not the width it
// draws while it animates open or closed.
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
    utilityRail: false,
  });
  const [layout, setLayout] = useState(() =>
    resolveContentLayout(measurementsRef.current),
  );
  const layoutRef = useRef(layout);

  const measure = useCallback(
    (next: Partial<ShellMeasurements>, { hold = true } = {}) => {
      measurementsRef.current = { ...measurementsRef.current, ...next };
      const resolved = resolveContentLayout({
        ...measurementsRef.current,
        previous: hold ? layoutRef.current : null,
      });
      if (sameContentLayout(resolved, layoutRef.current)) return;
      layoutRef.current = resolved;
      setLayout(resolved);
    },
    [],
  );

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
    let budgeted = CLOSED_AGENT_PANEL;
    let closing: { panel: HTMLElement; release: () => void } | null = null;
    const apply = (dock: AgentPanelDock) => {
      closing?.release();
      budgeted = dock;
      measure({ agentPanel: dock });
    };
    // Opening budgets the target width at once. A closing panel keeps its
    // layout budget until its width/transform transition ends.
    const holdClosingPanel = () => {
      const panel = agentPanelElements(shell).find(
        (element) =>
          element.classList.contains("agent-sidebar-panel") &&
          (element.dataset.agentSidebarLayout === "desktop" ||
            element.dataset.agentSidebarLayout === "overlay"),
      );
      const duration = panel ? panelTransitionMs(panel) : 0;
      if (!panel || duration <= 0) return false;
      const onTransitionEnd = (event: TransitionEvent) => {
        if (
          event.target === panel &&
          (event.propertyName === "width" ||
            (panel.dataset.agentSidebarLayout === "overlay" &&
              event.propertyName === "transform"))
        ) {
          apply(readAgentPanelDock(shell));
        }
      };
      const timer = window.setTimeout(
        () => apply(readAgentPanelDock(shell)),
        duration + AGENT_PANEL_CLOSE_SLACK_MS,
      );
      panel.addEventListener("transitionend", onTransitionEnd);
      panel.addEventListener("transitioncancel", onTransitionEnd);
      closing = {
        panel,
        release: () => {
          window.clearTimeout(timer);
          panel.removeEventListener("transitionend", onTransitionEnd);
          panel.removeEventListener("transitioncancel", onTransitionEnd);
          closing = null;
        },
      };
      return true;
    };
    const read = () => {
      const dock = readAgentPanelDock(shell);
      if (dock.open || !budgeted.open) {
        apply(dock);
      } else if (closing) {
        if (!agentPanelElements(shell).includes(closing.panel)) apply(dock);
      } else if (!holdClosingPanel()) {
        apply(dock);
      }
    };
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
      closing?.release();
    };
  }, [measure, shellRef]);

  // Counted, so a page that mounts before the previous one unmounts cannot
  // release the rail the new page holds. Opening or closing the rail is a
  // choice, not a window dragged across a threshold, so it resolves without
  // the modes on screen holding: a held docked sidebar or margin lane would
  // leave the text narrower than either side of the change.
  const utilityRailHolds = useRef(0);
  const holdUtilityRail = useCallback(() => {
    const update = (change: number) => {
      utilityRailHolds.current += change;
      const utilityRail = utilityRailHolds.current > 0;
      if (utilityRail === measurementsRef.current.utilityRail) return;
      measure({ utilityRail }, { hold: false });
    };
    update(1);
    return () => update(-1);
  }, [measure]);

  /** The widest the sidebar can be dragged and still stay docked. */
  const dockedSidebarMaxWidth = useCallback(
    () =>
      contentAvailableWidth(measurementsRef.current) -
      contentPageMinWidth(measurementsRef.current, layoutRef.current),
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

  return { layout, dockedSidebarMaxWidth, canDockSidebar, holdUtilityRail };
}
