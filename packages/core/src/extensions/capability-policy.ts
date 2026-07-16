export const EXTENSION_CAPABILITY_MANIFEST_VERSION = 1 as const;

export const EXTENSION_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
] as const;

export type ExtensionHttpMethod = (typeof EXTENSION_HTTP_METHODS)[number];

export interface ExtensionPathGrant {
  path: string;
  methods: ExtensionHttpMethod[];
}

export interface ExtensionOriginGrant {
  origin: string;
  methods: ExtensionHttpMethod[];
}

export interface ExtensionCapabilityManifestV1 {
  version: typeof EXTENSION_CAPABILITY_MANIFEST_VERSION;
  appActions?: string[];
  appFetch?: ExtensionPathGrant[];
  database?: {
    query?: boolean;
    exec?: boolean;
  };
  extensionData?: "read" | "write";
  externalFetch?: ExtensionOriginGrant[];
}

export interface ExtensionAcceptedGrantsV1 {
  version: typeof EXTENSION_CAPABILITY_MANIFEST_VERSION;
  appActions?: string[];
  appFetch?: ExtensionPathGrant[];
  database?: {
    query?: boolean;
    exec?: boolean;
  };
  extensionData?: "read" | "write";
  externalFetch?: ExtensionOriginGrant[];
}

export interface ExtensionCapabilityBinding {
  manifestVersion: number | null;
  manifestHash: string | null;
  consented: boolean;
  grants: ExtensionAcceptedGrantsV1 | null;
}

export type ExtensionCapabilityRequest =
  | { helper: "appAction"; action: string; readOnly: boolean }
  | { helper: "appFetch"; path: string; method: string }
  | { helper: "dbQuery" }
  | { helper: "dbExec" }
  | { helper: "extensionData"; method: string }
  | { helper: "extensionFetch"; url: string; method: string };

export type ExtensionCapabilityRole = "owner" | "admin" | "editor" | "viewer";

const METHOD_SET = new Set<string>(EXTENSION_HTTP_METHODS);
const READ_METHODS = new Set(["GET", "HEAD"]);

export function normalizeExtensionMethod(
  method: string,
): ExtensionHttpMethod | null {
  const normalized = method.trim().toUpperCase();
  return METHOD_SET.has(normalized)
    ? (normalized as ExtensionHttpMethod)
    : null;
}

export function normalizeExtensionCapabilityManifest(
  value: unknown,
): ExtensionCapabilityManifestV1 | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = parseObject(value);
  if (!raw || raw.version !== EXTENSION_CAPABILITY_MANIFEST_VERSION) {
    throw new Error("Extension capability manifest version must be 1");
  }

  return compactManifest({
    version: EXTENSION_CAPABILITY_MANIFEST_VERSION,
    appActions: normalizeActions(raw.appActions),
    appFetch: normalizePathGrants(raw.appFetch),
    database: normalizeDatabase(raw.database),
    extensionData: normalizeDataGrant(raw.extensionData),
    externalFetch: normalizeOriginGrants(raw.externalFetch),
  });
}

export function normalizeExtensionAcceptedGrants(
  value: unknown,
  manifest: ExtensionCapabilityManifestV1,
): ExtensionAcceptedGrantsV1 {
  const normalized = normalizeExtensionCapabilityManifest(value) ?? {
    version: EXTENSION_CAPABILITY_MANIFEST_VERSION,
  };
  assertGrantSubset(normalized, manifest);
  return normalized;
}

export function extensionCapabilityAllows(
  binding: ExtensionCapabilityBinding | null | undefined,
  role: ExtensionCapabilityRole,
  request: ExtensionCapabilityRequest,
): boolean {
  const grants = binding?.consented ? binding.grants : null;

  // Legacy and unaccepted manifests run in a small compatibility sandbox:
  // read-only actions, application-state reads, and extensionData reads.
  if (!grants) return legacyAllows(request);

  switch (request.helper) {
    case "appAction":
      if (!grants.appActions?.includes(request.action)) return false;
      return request.readOnly || role !== "viewer";
    case "appFetch": {
      const method = normalizeExtensionMethod(request.method);
      if (!method) return false;
      if (method !== "GET" && method !== "HEAD" && role === "viewer") {
        return false;
      }
      return pathGrantAllows(grants.appFetch, request.path, method);
    }
    case "dbQuery":
      return role !== "viewer" && grants.database?.query === true;
    case "dbExec":
      return role !== "viewer" && grants.database?.exec === true;
    case "extensionData": {
      const method = normalizeExtensionMethod(request.method);
      if (!method) return false;
      if (READ_METHODS.has(method)) return grants.extensionData !== undefined;
      return role !== "viewer" && grants.extensionData === "write";
    }
    case "extensionFetch": {
      const method = normalizeExtensionMethod(request.method);
      if (!method) return false;
      let origin: string;
      try {
        origin = new URL(request.url).origin;
      } catch {
        return false;
      }
      return originGrantAllows(grants.externalFetch, origin, method);
    }
  }
}

function legacyAllows(request: ExtensionCapabilityRequest): boolean {
  if (request.helper === "appAction") return request.readOnly;
  if (request.helper === "appFetch") {
    const method = normalizeExtensionMethod(request.method);
    return (
      !!method &&
      READ_METHODS.has(method) &&
      request.path.startsWith("/_agent-native/application-state/")
    );
  }
  if (request.helper === "extensionData") {
    const method = normalizeExtensionMethod(request.method);
    return !!method && READ_METHODS.has(method);
  }
  return false;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Extension capability manifest must be valid JSON");
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeActions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("appActions must be an array");
  const actions = [...new Set(value.map((item) => String(item).trim()))]
    .filter(Boolean)
    .sort();
  if (actions.some((action) => action === "*" || action.includes("/"))) {
    throw new Error("appActions must name exact actions");
  }
  return actions.length ? actions : undefined;
}

function normalizeMethods(value: unknown): ExtensionHttpMethod[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Capability methods must be a non-empty array");
  }
  const methods = [
    ...new Set(value.map((item) => normalizeExtensionMethod(String(item)))),
  ];
  if (methods.some((method) => method === null)) {
    throw new Error("Capability contains an unsupported HTTP method");
  }
  return (methods as ExtensionHttpMethod[]).sort();
}

function normalizePathGrants(value: unknown): ExtensionPathGrant[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("appFetch must be an array");
  const grants = value.map((item) => {
    const raw = parseObject(item);
    const path = typeof raw?.path === "string" ? raw.path.trim() : "";
    if (!path.startsWith("/_agent-native/") || path.includes("..")) {
      throw new Error("appFetch paths must be exact /_agent-native/ paths");
    }
    return { path, methods: normalizeMethods(raw?.methods) };
  });
  return grants.length
    ? grants.sort((a, b) => a.path.localeCompare(b.path))
    : undefined;
}

function normalizeOriginGrants(
  value: unknown,
): ExtensionOriginGrant[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("externalFetch must be an array");
  const grants = value.map((item) => {
    const raw = parseObject(item);
    const input = typeof raw?.origin === "string" ? raw.origin.trim() : "";
    let origin: string;
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== "https:" || parsed.origin !== input)
        throw new Error();
      origin = parsed.origin;
    } catch {
      throw new Error("externalFetch origins must be exact HTTPS origins");
    }
    return { origin, methods: normalizeMethods(raw?.methods) };
  });
  return grants.length
    ? grants.sort((a, b) => a.origin.localeCompare(b.origin))
    : undefined;
}

function normalizeDatabase(
  value: unknown,
): ExtensionCapabilityManifestV1["database"] {
  if (value === undefined) return undefined;
  const raw = parseObject(value);
  if (!raw) throw new Error("database must be an object");
  const database = {
    ...(raw.query === true ? { query: true } : {}),
    ...(raw.exec === true ? { exec: true } : {}),
  };
  return Object.keys(database).length ? database : undefined;
}

function normalizeDataGrant(value: unknown): "read" | "write" | undefined {
  if (value === undefined) return undefined;
  if (value !== "read" && value !== "write") {
    throw new Error("extensionData must be read or write");
  }
  return value;
}

function compactManifest<T extends ExtensionCapabilityManifestV1>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function assertGrantSubset(
  grants: ExtensionAcceptedGrantsV1,
  manifest: ExtensionCapabilityManifestV1,
): void {
  for (const action of grants.appActions ?? []) {
    if (!manifest.appActions?.includes(action))
      throw new Error(`Action grant '${action}' is not declared`);
  }
  for (const grant of grants.appFetch ?? []) {
    const declared = manifest.appFetch?.find(
      (item) => item.path === grant.path,
    );
    if (
      !declared ||
      grant.methods.some((method) => !declared.methods.includes(method))
    ) {
      throw new Error(`appFetch grant '${grant.path}' exceeds the manifest`);
    }
  }
  if (grants.database?.query && !manifest.database?.query)
    throw new Error("dbQuery grant is not declared");
  if (grants.database?.exec && !manifest.database?.exec)
    throw new Error("dbExec grant is not declared");
  if (grants.extensionData === "write" && manifest.extensionData !== "write")
    throw new Error("extensionData write grant is not declared");
  if (grants.extensionData === "read" && !manifest.extensionData)
    throw new Error("extensionData read grant is not declared");
  for (const grant of grants.externalFetch ?? []) {
    const declared = manifest.externalFetch?.find(
      (item) => item.origin === grant.origin,
    );
    if (
      !declared ||
      grant.methods.some((method) => !declared.methods.includes(method))
    ) {
      throw new Error(
        `externalFetch grant '${grant.origin}' exceeds the manifest`,
      );
    }
  }
}

function pathGrantAllows(
  grants: ExtensionPathGrant[] | undefined,
  path: string,
  method: ExtensionHttpMethod,
): boolean {
  let pathname: string;
  try {
    pathname = new URL(path, "http://agent-native.local").pathname;
  } catch {
    return false;
  }
  return !!grants?.some(
    (grant) => grant.path === pathname && grant.methods.includes(method),
  );
}

function originGrantAllows(
  grants: ExtensionOriginGrant[] | undefined,
  origin: string,
  method: ExtensionHttpMethod,
): boolean {
  return !!grants?.some(
    (grant) => grant.origin === origin && grant.methods.includes(method),
  );
}
