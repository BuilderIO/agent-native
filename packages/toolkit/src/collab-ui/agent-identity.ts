// Reserve the maximum signed 32-bit id so the agent never wins client leader election.
export const AGENT_CLIENT_ID = 2147483647;

export interface AgentIdentity {
  clientId: number;
  name: string;
  email: string;
  color: string;
}

export const DEFAULT_AGENT_IDENTITY: AgentIdentity = {
  clientId: AGENT_CLIENT_ID,
  name: "AI Assistant",
  email: "agent@system",
  color: "#00B5FF",
};
