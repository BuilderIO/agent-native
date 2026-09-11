export type ConnectScope = "project" | "user";

export interface ConnectCommandInput {
  appUrl: string;
  scope: ConnectScope;
}

export interface DesignConnectCommandInput {
  devServerUrl: string;
  rootPath: string;
  port?: number;
  routeManifest?: string;
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

export function buildDesignConnectCommand(
  input: DesignConnectCommandInput,
): string {
  return [
    "npx",
    "-y",
    "@agent-native/core@latest",
    "design",
    "connect",
    "--url",
    shellQuote(input.devServerUrl),
    "--root",
    shellQuote(input.rootPath),
    ...(input.port ? ["--port", String(input.port)] : []),
    ...(input.routeManifest
      ? ["--route-manifest", shellQuote(input.routeManifest)]
      : []),
  ].join(" ");
}
