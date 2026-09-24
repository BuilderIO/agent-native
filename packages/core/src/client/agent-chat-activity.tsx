import { createContext, useContext, type ReactNode } from "react";

const AgentChatActivity = createContext(true);

/** Keep an originating composer mounted while a focused workspace owns chat. */
export function AgentChatActivityProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <AgentChatActivity.Provider value={active}>
      {children}
    </AgentChatActivity.Provider>
  );
}

export function useAgentChatActivity(): boolean {
  return useContext(AgentChatActivity);
}
