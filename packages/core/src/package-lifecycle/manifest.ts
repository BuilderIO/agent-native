export const AGENT_NATIVE_PACKAGE_MANIFEST_VERSION = 1 as const;

export interface AgentNativePackageManifest {
  manifestVersion: typeof AGENT_NATIVE_PACKAGE_MANIFEST_VERSION;
  name: string;
  actions: string[];
  schemaEntryPoint: string;
  docs: {
    llms: string;
    llmsFull: string;
    skills: string[];
  };
  requiredSecrets: { key: string; label: string; optional?: boolean }[];
  peerProviders: string[];
  eject?: {
    sourceRoot: string;
    targetDirectory: string;
  };
}

export function assertAgentNativePackageManifest(
  value: unknown,
): asserts value is AgentNativePackageManifest {
  const manifest = value as Partial<AgentNativePackageManifest> | null;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Package manifest must be an object");
  }
  if (manifest.manifestVersion !== AGENT_NATIVE_PACKAGE_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported package manifest version ${String(manifest.manifestVersion)}`,
    );
  }
  if (!manifest.name || !manifest.schemaEntryPoint) {
    throw new Error("Package manifest is missing name or schemaEntryPoint");
  }
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(manifest.name)) {
    throw new Error(`Invalid package manifest name: ${manifest.name}`);
  }
  if (
    !manifest.schemaEntryPoint.startsWith(`${manifest.name}/`) ||
    !isSafeSpecifier(manifest.schemaEntryPoint)
  ) {
    throw new Error("Package manifest schemaEntryPoint is unsafe");
  }
  if (
    !Array.isArray(manifest.actions) ||
    !manifest.docs ||
    !Array.isArray(manifest.docs.skills) ||
    !Array.isArray(manifest.requiredSecrets) ||
    !Array.isArray(manifest.peerProviders)
  ) {
    throw new Error("Package manifest contribution lists are invalid");
  }
  for (const action of manifest.actions) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(action)) {
      throw new Error(`Invalid package action name: ${action}`);
    }
  }
  for (const skill of manifest.docs.skills) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) {
      throw new Error(`Invalid package skill name: ${skill}`);
    }
  }
  for (const docPath of [manifest.docs.llms, manifest.docs.llmsFull]) {
    if (!isSafeRelativePath(docPath)) {
      throw new Error(`Unsafe package documentation path: ${docPath}`);
    }
  }
  for (const secret of manifest.requiredSecrets) {
    if (
      !secret ||
      !/^[A-Z][A-Z0-9_]*$/.test(secret.key) ||
      typeof secret.label !== "string" ||
      secret.label.length === 0 ||
      secret.label.length > 120 ||
      (secret.optional !== undefined && typeof secret.optional !== "boolean")
    ) {
      throw new Error("Invalid package requiredSecrets entry");
    }
  }
  for (const provider of manifest.peerProviders) {
    if (
      typeof provider !== "string" ||
      !/^[a-z0-9][a-z0-9-]*$/.test(provider)
    ) {
      throw new Error(`Invalid package peer provider: ${String(provider)}`);
    }
  }
  if (
    manifest.eject &&
    (!isSafeRelativePath(manifest.eject.sourceRoot) ||
      !isSafeRelativePath(manifest.eject.targetDirectory))
  ) {
    throw new Error("Package eject paths must be safe relative paths");
  }
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    return false;
  }
  if (
    value.includes("\0") ||
    value.startsWith("/") ||
    pathSegments(value).includes("..")
  ) {
    return false;
  }
  return !value.split("/").includes("");
}

function isSafeSpecifier(value: string): boolean {
  return (
    /^[A-Za-z0-9@._/-]+$/.test(value) && !pathSegments(value).includes("..")
  );
}

function pathSegments(value: string): string[] {
  return value.split("/");
}
