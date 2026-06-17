export type ConnectScope = "project" | "user";

export interface ConnectCommandInput {
  appUrl: string;
  scope: ConnectScope;
}

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildConnectCommand(input: ConnectCommandInput): string {
  return [
    "npx",
    "-y",
    "@agent-native/core@latest",
    "connect",
    shellQuote(input.appUrl),
    "--client",
    "github-copilot",
    "--scope",
    input.scope,
  ].join(" ");
}
