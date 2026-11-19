import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

// A page's panel holds the agent, but the chat belongs to the shell, which
// outlasts any one page. The shell draws the chat into one element for the
// whole session and the page holds that element in its panel, so moving
// between pages moves the element without reloading the chat.

interface AgentPanelHost {
  /** Keeps the chat out of the shell's sidebar; the returned call releases it. */
  hold: () => () => void;
  /** Puts the chat in `slot`; the returned call takes it back out. */
  attach: (slot: HTMLElement) => () => void;
}

const AgentPanelHostContext = createContext<AgentPanelHost | null>(null);

export const AgentPanelHostProvider = AgentPanelHostContext.Provider;

/** The shell's half: `panelHost` is set while a page has a panel to hold it. */
export function useAgentPanelHost() {
  const [element] = useState(() => {
    if (typeof document === "undefined") return null;
    const node = document.createElement("div");
    node.className = "flex min-h-0 flex-1 flex-col";
    return node;
  });
  // Counted, so a page that mounts before the previous one unmounts cannot
  // release the hold the new page took.
  const [holds, setHolds] = useState(0);
  const host = useMemo<AgentPanelHost>(
    () => ({
      hold() {
        setHolds((count) => count + 1);
        return () => setHolds((count) => count - 1);
      },
      attach(slot) {
        if (element) slot.append(element);
        return () => {
          if (element?.parentElement === slot) element.remove();
        };
      },
    }),
    [element],
  );
  return { host, panelHost: holds > 0 ? element : undefined };
}

/**
 * Holds the chat for a page that is still loading, so the agent waits for the
 * page's panel instead of opening in the shell's sidebar and moving.
 */
export function useHoldAgentPanel(enabled = true) {
  const host = useContext(AgentPanelHostContext);
  useLayoutEffect(
    () => (enabled && host ? host.hold() : undefined),
    [enabled, host],
  );
}

/**
 * A page's half: the chat draws inside `slotRef` while this is mounted. Says
 * whether there is a chat to draw, which there is not outside the app shell.
 */
export function useAgentPanelSlot(
  slotRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const host = useContext(AgentPanelHostContext);
  useHoldAgentPanel(enabled);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    return enabled && host && slot ? host.attach(slot) : undefined;
  }, [enabled, host, slotRef]);
  return enabled && Boolean(host);
}
