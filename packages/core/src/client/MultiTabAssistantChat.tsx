import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  AssistantChat,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
import { generateTabId } from "./agent-chat.js";
import { getHarnessOrigin } from "./harness.js";

// ─── Inline Icons ───────────────────────────────────────────────────────────

function IconX({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatTab {
  id: string;
  label: string;
  status: "idle" | "running" | "completed";
}

let labelCounter = 0;
function createChatTab(): ChatTab {
  return {
    id: generateTabId(),
    label: String(++labelCounter),
    status: "idle",
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export type MultiTabAssistantChatProps = Omit<AssistantChatProps, "tabId">;

export function MultiTabAssistantChat(props: MultiTabAssistantChatProps) {
  const [tabs, setTabs] = useState<ChatTab[]>(() => [createChatTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const chatRefs = useRef<Map<string, AssistantChatHandle>>(new Map());
  const pendingSends = useRef<Map<string, string>>(new Map());

  // Listen for builder.submitChat postMessages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from same origin or known harness
      if (
        event.origin !== window.location.origin &&
        event.origin !== getHarnessOrigin()
      ) {
        return;
      }
      if (event.data?.type !== "builder.submitChat") return;
      const message = event.data.data?.message as string;
      if (!message) return;

      const currentTabId = activeTabIdRef.current;
      const activeRef = chatRefs.current.get(currentTabId);
      const running = activeRef?.isRunning() ?? false;

      if (!running) {
        // Send to the current active tab
        if (activeRef) {
          activeRef.sendMessage(message);
        } else {
          // Ref not yet mounted — queue it
          pendingSends.current.set(currentTabId, message);
        }
      } else {
        // Active tab is busy — create a new tab
        const tab = createChatTab();
        pendingSends.current.set(tab.id, message);
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []); // stable — uses refs instead of state

  // Process pending sends when refs mount
  useEffect(() => {
    for (const [tabId, message] of pendingSends.current) {
      const ref = chatRefs.current.get(tabId);
      if (ref) {
        // Small delay to let the runtime initialise
        setTimeout(() => ref.sendMessage(message), 50);
        pendingSends.current.delete(tabId);
      }
    }
  }, [tabs]);

  // Listen for chatRunning completion events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { isRunning, tabId } = detail;
      if (!tabId) return;

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          if (isRunning === false) return { ...t, status: "completed" };
          if (isRunning === true) return { ...t, status: "running" };
          return t;
        }),
      );
    };
    window.addEventListener("builder.fusion.chatRunning", handler);
    return () =>
      window.removeEventListener("builder.fusion.chatRunning", handler);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
        }
        return next;
      });
      chatRefs.current.delete(tabId);
      pendingSends.current.delete(tabId);
    },
    [activeTabId],
  );

  const showTabs = tabs.length > 1;

  return (
    <div className="flex flex-1 flex-col h-full min-h-0">
      {showTabs && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                tab.id === activeTabId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <span>{tab.label}</span>
              {tab.status === "completed" && (
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              )}
              {tabs.length > 1 && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="text-muted-foreground/50 hover:text-muted-foreground ml-0.5"
                >
                  <IconX size={10} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Render all tabs, hide inactive ones to preserve state */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="flex-1 min-h-0"
          style={{ display: tab.id === activeTabId ? "flex" : "none" }}
        >
          <AssistantChat
            ref={(handle) => {
              if (handle) {
                chatRefs.current.set(tab.id, handle);
              } else {
                chatRefs.current.delete(tab.id);
              }
            }}
            tabId={tab.id}
            {...props}
          />
        </div>
      ))}
    </div>
  );
}
