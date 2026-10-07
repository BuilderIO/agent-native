import { HeaderActionsProvider } from "@agent-native/toolkit/app-shell";

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Clean Agent-Native app shell: a single full-height canvas with no chat or
 * agent UI mounted by default. The app already satisfies the Agent-Native
 * contract (data in SQL, actions as the source of truth, application state for
 * navigation, real-time sync) — the agent rail and chat are opt-in surfaces.
 *
 * To add the persistent agent rail when the user asks for it, wrap {children}
 * in `AgentSidebar` from "@agent-native/core/client/agent-chat"
 * (position="right", a stable storageKey, browserTabId={TAB_ID} from
 * "@/lib/tab-id"). See the `agent-native-toolkit` skill for the full pattern.
 */
export function Layout({ children }: LayoutProps) {
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <main className="agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </main>
      </div>
    </HeaderActionsProvider>
  );
}
