import { injectedAgentNativeConfig } from "./app-config.js";
import { clientBuildId } from "./build-compatibility.js";

declare const __AGENT_NATIVE_PACKAGE_VERSIONS__:
  | Record<string, string>
  | undefined;

export interface AgentNativePackageVersion {
  name: string;
  version: string;
}

export interface AgentNativeDiagnostics {
  buildId: string;
  environment: string;
  packages: Record<string, string>;
}

function readPackageVersions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([name, version]) =>
          name.startsWith("@agent-native/") &&
          typeof version === "string" &&
          version.trim().length > 0,
      )
      .map(([name, version]) => [name, version.trim()]),
  );
}

function injectedPackageVersions(): Record<string, string> {
  if (typeof __AGENT_NATIVE_PACKAGE_VERSIONS__ !== "undefined") {
    return readPackageVersions(__AGENT_NATIVE_PACKAGE_VERSIONS__);
  }

  return readPackageVersions(
    (
      globalThis as typeof globalThis & {
        __AGENT_NATIVE_PACKAGE_VERSIONS__?: unknown;
      }
    ).__AGENT_NATIVE_PACKAGE_VERSIONS__,
  );
}

export function getAgentNativePackageVersions(): AgentNativePackageVersion[] {
  return Object.entries(injectedPackageVersions())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => ({ name, version }));
}

export function getAgentNativeDiagnostics(): AgentNativeDiagnostics {
  return {
    buildId: clientBuildId() || "development",
    environment:
      injectedAgentNativeConfig().deployment?.environment ?? "unknown",
    packages: Object.fromEntries(
      getAgentNativePackageVersions().map(({ name, version }) => [
        name,
        version,
      ]),
    ),
  };
}

export function formatAgentNativeDiagnostics(): string {
  return JSON.stringify(getAgentNativeDiagnostics(), null, 2);
}
