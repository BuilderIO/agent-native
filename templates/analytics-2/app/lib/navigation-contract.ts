export type NavigableKind =
  | "project"
  | "thread"
  | "collection"
  | "data-connection";

const SCOPED_DATA_RESOURCE_PREFIX = "dsr1:";
const SCOPED_DATA_RESOURCE_KINDS = ["database", "schema", "table"] as const;

export type DataBrowserResourceKind =
  (typeof SCOPED_DATA_RESOURCE_KINDS)[number];

export interface FocusedResource {
  resourceKind: NavigableKind;
  resourceId: string;
  dataResourceKind?: DataBrowserResourceKind;
  dataResourceId?: string;
  dataResourceName?: string;
  dataSchemaName?: string;
}

export function dataBrowserResourcePath(
  connectionId: string,
  kind: DataBrowserResourceKind,
  resourceId: string,
  tab = "all",
): string {
  const scoped = `${SCOPED_DATA_RESOURCE_PREFIX}${encodeURIComponent(
    JSON.stringify([connectionId, kind, resourceId]),
  )}`;
  return `/home/data/${encodeURIComponent(tab)}/${kind}/${encodeURIComponent(scoped)}`;
}

function decodeScopedDataResource(value: string):
  | {
      connectionId: string;
      kind: DataBrowserResourceKind;
      resourceId: string;
    }
  | undefined {
  if (!value.startsWith(SCOPED_DATA_RESOURCE_PREFIX)) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      decodeURIComponent(value.slice(SCOPED_DATA_RESOURCE_PREFIX.length)),
    );
    if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
    const [connectionId, kind, resourceId] = parsed;
    if (typeof connectionId !== "string" || !connectionId) return undefined;
    if (typeof resourceId !== "string" || !resourceId) return undefined;
    if (
      typeof kind !== "string" ||
      !(SCOPED_DATA_RESOURCE_KINDS as readonly string[]).includes(kind)
    ) {
      return undefined;
    }
    return {
      connectionId,
      kind: kind as DataBrowserResourceKind,
      resourceId,
    };
  } catch {
    return undefined;
  }
}

function decodeSegment(segment: string | undefined): string | undefined {
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function parseDataResourceNames(resourceId: string): {
  dataResourceName?: string;
  dataSchemaName?: string;
} {
  const parts = resourceId.split(":");
  const prefix = parts[0];
  if (prefix === "table" && parts.length >= 4) {
    const dataResourceName = decodeSegment(parts[3]);
    const dataSchemaName = decodeSegment(parts[2]);
    return {
      ...(dataResourceName ? { dataResourceName } : {}),
      ...(dataSchemaName ? { dataSchemaName } : {}),
    };
  }
  if (prefix === "pg-table" && parts.length >= 5) {
    const dataResourceName = decodeSegment(parts[3]);
    const dataSchemaName = decodeSegment(parts[2]);
    return {
      ...(dataResourceName ? { dataResourceName } : {}),
      ...(dataSchemaName ? { dataSchemaName } : {}),
    };
  }
  if (prefix === "schema" && parts.length >= 2) {
    const dataSchemaName = decodeSegment(parts.at(-1));
    return dataSchemaName
      ? { dataResourceName: dataSchemaName, dataSchemaName }
      : {};
  }
  if (prefix === "database" && parts.length >= 2) {
    const dataResourceName = decodeSegment(parts.at(-1));
    return dataResourceName ? { dataResourceName } : {};
  }
  return {};
}

export function resourcePath(kind: NavigableKind, id: string): string {
  const encoded = encodeURIComponent(id);
  switch (kind) {
    case "project":
      return `/project/${encoded}/latest`;
    case "thread":
      return `/thread/${encoded}`;
    case "data-connection":
      return `/home/data/all/data-connection/${encoded}`;
    case "collection":
      return `/collection/${encoded}`;
  }
}

export function focusedResource(
  pathname: string,
): FocusedResource | { resourceStatus: "invalid-id" } | undefined {
  let parts: string[];
  try {
    const normalized = new URL(pathname, "https://navigation.invalid");
    if (normalized.origin !== "https://navigation.invalid")
      return { resourceStatus: "invalid-id" };
    parts = normalized.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    return { resourceStatus: "invalid-id" };
  }
  const lower = parts.map((part) => part.toLowerCase());
  let kind: NavigableKind | undefined;
  let id: string | undefined;
  if (
    [
      "project",
      "app",
      "code-app",
      "component",
      "explore",
      "explore-new",
      "screenshot",
    ].includes(lower[0] ?? "")
  ) {
    kind = "project";
    id = parts[1];
  } else if (lower[0] === "thread" || lower[0] === "collection") {
    kind = lower[0];
    id = parts[1];
  } else if (lower[0] === "dev" && lower[1] === "agent-chat-thread") {
    kind = "thread";
    id = parts[2];
  } else if (
    lower[0] === "home" &&
    lower[1] === "data" &&
    lower[3] === "data-connection"
  ) {
    kind = "data-connection";
    id = parts[4];
  } else if (
    lower[0] === "home" &&
    lower[1] === "data" &&
    (SCOPED_DATA_RESOURCE_KINDS as readonly string[]).includes(
      lower[3] ?? "",
    ) &&
    parts[4]?.startsWith(SCOPED_DATA_RESOURCE_PREFIX)
  ) {
    const scoped = decodeScopedDataResource(parts[4]);
    if (!scoped || scoped.kind !== lower[3]) {
      return { resourceStatus: "invalid-id" };
    }
    return {
      resourceKind: "data-connection",
      resourceId: scoped.connectionId,
      dataResourceKind: scoped.kind,
      dataResourceId: scoped.resourceId,
      ...parseDataResourceNames(scoped.resourceId),
    };
  }
  return kind && id ? { resourceKind: kind, resourceId: id } : undefined;
}

const HOME_VIEW_PATHS: Readonly<Record<string, string>> = {
  home: "/home",
  recent: "/home",
  recents: "/home",
  "recent-projects": "/home",
  all: "/home/all",
  projects: "/home/all",
  archive: "/home/archive",
  archived: "/home/archive",
  trash: "/home/trash",
  data: "/home/data",
  threads: "/home/threads",
  collections: "/home/collections",
  library: "/home/library",
  search: "/home/search",
  components: "/home/components",
  tasks: "/home/tasks",
  folders: "/home/folders",
  drafts: "/home/drafts",
};

const HOME_ALIAS_PATHS: Readonly<Record<string, string>> = {
  "/recent": "/home",
  "/recents": "/home",
  "/recent-projects": "/home",
  "/all": "/home/all",
  "/archive": "/home/archive",
  "/archived": "/home/archive",
  "/home/archived": "/home/archive",
  "/collections": "/home/collections",
};

export function pathFromView(view: string | undefined): string {
  if (!view) return "/home";
  const trimmed = view.trim().replace(/^\/+/, "");
  if (!trimmed) return "/home";
  const lower = trimmed.toLowerCase();
  const mapped = HOME_VIEW_PATHS[lower];
  if (mapped) return mapped;
  if (lower === "home/archived") return "/home/archive";
  return `/${trimmed}`;
}

export function normalizeAnalyticsNavigationPath(
  pathname: string,
  mountedAppIds: readonly string[] = ["analytics-2"],
): string {
  let normalized = pathname;
  for (const appId of mountedAppIds) {
    const cleanId = appId.trim().replace(/^\/+|\/+$/g, "");
    if (!cleanId) continue;
    const prefix = `/${cleanId.toLowerCase()}`;
    const lower = normalized.toLowerCase();
    if (lower === prefix || lower === `${prefix}/`) {
      normalized = "/home";
      break;
    }
    if (lower.startsWith(`${prefix}/`)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }
  const withoutTrailingSlash =
    normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  const alias = HOME_ALIAS_PATHS[withoutTrailingSlash.toLowerCase()];
  return alias ?? normalized;
}
