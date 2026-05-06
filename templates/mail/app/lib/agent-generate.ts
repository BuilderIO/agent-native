import { agentNativePath } from "@agent-native/core/client";

async function readStatus(path: string): Promise<any | null> {
  return fetch(agentNativePath(path))
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

export async function canUseAgentGenerate(): Promise<boolean> {
  const [builderStatus, engineStatus] = await Promise.all([
    readStatus("/_agent-native/builder/status"),
    readStatus("/_agent-native/agent-engine/status"),
  ]);

  if (builderStatus == null && engineStatus == null) {
    return true;
  }

  return (
    builderStatus?.configured === true || engineStatus?.configured === true
  );
}
