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
// whole session, and its tools into another for the panel's head, and the
// page holds both in its panel, so moving between pages moves them without
// reloading the chat.

interface AgentPanelHost {
  /** Keeps the chat out of the shell's sidebar; the returned call releases it. */
  hold: () => () => void;
  /**
   * Puts the chat in `slot` and its tools in `headSlot`; the returned call
   * takes them back out.
   */
  attach: (slot: HTMLElement, headSlot?: HTMLElement | null) => () => void;
}

const AgentPanelHostContext = createContext<AgentPanelHost | null>(null);

export const AgentPanelHostProvider = AgentPanelHostContext.Provider;

/** The shell's half: `panelHost` is set while a page has a panel to hold it. */
export function useAgentPanelHost() {
  const [element] = useState(() =>
    createHostElement("flex min-h-0 flex-1 flex-col"),
  );
  const [headElement] = useState(() =>
    createHostElement("flex min-w-0 flex-1 items-center"),
  );
  // Counted, so a page that mounts before the previous one unmounts cannot
  // release the hold the new page took.
  const [holds, setHolds] = useState(0);
  const host = useMemo<AgentPanelHost>(
    () => ({
      hold() {
        setHolds((count) => count + 1);
        return () => setHolds((count) => count - 1);
      },
      attach(slot, headSlot) {
        if (element) slot.append(element);
        if (headSlot && headElement) headSlot.append(headElement);
        return () => {
          if (element?.parentElement === slot) element.remove();
          if (headSlot && headElement?.parentElement === headSlot) {
            headElement.remove();
          }
        };
      },
    }),
    [element, headElement],
  );
  const held = holds > 0;
  return {
    host,
    panelHost: held ? element : undefined,
    panelHeadHost: held ? headElement : undefined,
  };
}

function createHostElement(className: string) {
  if (typeof document === "undefined") return null;
  const node = document.createElement("div");
  node.className = className;
  return node;
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

type SlotRef = RefObject<HTMLElement | null>;

/**
 * A page's half: the chat draws inside `slotRef`, and its tools inside
 * `headSlotRef`, while this is mounted. Says whether there is a chat to draw,
 * which there is not outside the app shell.
 */
export function useAgentPanelSlot(
  slotRef: SlotRef,
  enabled: boolean,
  headSlotRef?: SlotRef,
) {
  const host = useContext(AgentPanelHostContext);
  useHoldAgentPanel(enabled);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    return enabled && host && slot
      ? host.attach(slot, headSlotRef?.current)
      : undefined;
  }, [enabled, host, slotRef, headSlotRef]);
  return enabled && Boolean(host);
}
