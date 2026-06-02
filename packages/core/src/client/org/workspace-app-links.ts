import { useEffect, useMemo, useState } from "react";
import { coreTemplates, getTemplate } from "../../cli/templates-meta.js";

export interface OrgSwitcherAppLink {
  id: string;
  name: string;
  href: string;
  description?: string;
  icon?: string;
  isDispatch: boolean;
  status?: "ready" | "pending";
}

export interface VisibleOrgAppLinks {
  links: OrgSwitcherAppLink[];
  overflowCount: number;
}

type RuntimeEnv = Record<string, string | boolean | undefined>;

const DISPATCH_ID = "dispatch";
export const ORG_SWITCHER_MAX_APP_LINKS = 9;

function runtimeEnv(): RuntimeEnv {
  return (
    (
      import.meta as unknown as {
        env?: RuntimeEnv;
      }
    ).env ?? {}
  );
}

function envString(env: RuntimeEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function appendPath(base: string, path: string): string {
  const segment = path.replace(/^\/+/, "");
  try {
    const url = new URL(base);
    url.pathname = `${stripTrailingSlash(url.pathname)}/${segment}`.replace(
      /\/+/g,
      "/",
    );
    return url.toString();
  } catch {
    return `${stripTrailingSlash(base)}/${segment}`;
  }
}

function dispatchBaseHref(href: string): string {
  try {
    const url = new URL(href);
    url.pathname = url.pathname.replace(/\/(?:overview|apps)\/?$/, "") || "/";
    url.search = "";
    url.hash = "";
    return stripTrailingSlash(url.toString());
  } catch {
    return stripTrailingSlash(
      href.replace(/\/(?:overview|apps)\/?$/, "") || "/dispatch",
    );
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function workspaceHref(
  pathValue: string,
  explicitUrl: string | null | undefined,
  env: RuntimeEnv,
): string {
  const url = explicitUrl?.trim();
  if (url) {
    if (url.startsWith("/")) return workspaceHref(url, null, env);
    if (isAbsoluteUrl(url)) return url;
    return url;
  }

  const path = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  const gatewayUrl = envString(env, "VITE_WORKSPACE_GATEWAY_URL");
  if (!gatewayUrl) return path;

  try {
    return new URL(path, `${stripTrailingSlash(gatewayUrl)}/`).toString();
  } catch {
    return path;
  }
}

function appEntryToLink(
  entry: unknown,
  env: RuntimeEnv,
): OrgSwitcherAppLink | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;

  const pathValue =
    typeof record.path === "string" && record.path.trim()
      ? record.path.trim()
      : `/${id}`;
  const explicitUrl =
    typeof record.url === "string" && record.url.trim()
      ? record.url.trim()
      : typeof record.builderUrl === "string" && record.builderUrl.trim()
        ? record.builderUrl.trim()
        : null;
  const baseHref = workspaceHref(pathValue, explicitUrl, env);
  const isDispatch =
    typeof record.isDispatch === "boolean"
      ? record.isDispatch
      : id === DISPATCH_ID;
  const icon =
    typeof record.icon === "string" && record.icon.trim()
      ? record.icon.trim()
      : getTemplate(id)?.icon;

  return {
    id,
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : titleCase(id),
    href: isDispatch ? appendPath(baseHref, "overview") : baseHref,
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined,
    ...(icon ? { icon } : {}),
    isDispatch,
    status: record.status === "pending" ? "pending" : "ready",
  };
}

function sortAppLinks(apps: OrgSwitcherAppLink[]): OrgSwitcherAppLink[] {
  return [...apps].sort((a, b) => {
    if (a.isDispatch && !b.isDispatch) return -1;
    if (!a.isDispatch && b.isDispatch) return 1;
    if (a.status === "pending" && b.status !== "pending") return 1;
    if (a.status !== "pending" && b.status === "pending") return -1;
    return a.name.localeCompare(b.name);
  });
}

function dedupeAppLinks(apps: OrgSwitcherAppLink[]): OrgSwitcherAppLink[] {
  const seen = new Set<string>();
  const deduped: OrgSwitcherAppLink[] = [];
  for (const app of apps) {
    if (seen.has(app.id)) continue;
    seen.add(app.id);
    deduped.push(app);
  }
  return deduped;
}

export function parseWorkspaceAppLinks(
  payload: unknown,
  env: RuntimeEnv = runtimeEnv(),
): OrgSwitcherAppLink[] | null {
  const rawApps = Array.isArray((payload as { apps?: unknown[] })?.apps)
    ? (payload as { apps: unknown[] }).apps
    : Array.isArray(payload)
      ? payload
      : null;
  if (!rawApps) return null;

  const apps = rawApps
    .map((entry) => appEntryToLink(entry, env))
    .filter((app): app is OrgSwitcherAppLink => Boolean(app));

  return apps.length ? sortAppLinks(dedupeAppLinks(apps)) : null;
}

export function parseWorkspaceAppLinksJson(
  raw: string | undefined,
  env: RuntimeEnv = runtimeEnv(),
): OrgSwitcherAppLink[] | null {
  if (!raw) return null;
  try {
    return parseWorkspaceAppLinks(JSON.parse(raw), env);
  } catch {
    return null;
  }
}

export function defaultOrgAppLinks(): OrgSwitcherAppLink[] {
  return sortAppLinks(
    coreTemplates()
      .filter((template) => !template.hidden && template.prodUrl)
      .map((template) => ({
        id: template.name,
        name: template.label,
        href:
          template.name === DISPATCH_ID
            ? appendPath(template.prodUrl!, "overview")
            : template.prodUrl!,
        description: template.hint,
        icon: template.icon,
        isDispatch: template.name === DISPATCH_ID,
        status: "ready" as const,
      })),
  );
}

export function isWorkspaceAppEnvironment(
  env: RuntimeEnv = runtimeEnv(),
): boolean {
  return (
    envString(env, "VITE_AGENT_NATIVE_WORKSPACE") === "1" ||
    Boolean(envString(env, "VITE_WORKSPACE_GATEWAY_URL")) ||
    Boolean(envString(env, "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON"))
  );
}

export function dispatchOverviewHref(
  apps: OrgSwitcherAppLink[],
  env: RuntimeEnv = runtimeEnv(),
): string {
  const dispatch = apps.find((app) => app.isDispatch);
  if (dispatch) return appendPath(dispatchBaseHref(dispatch.href), "overview");
  return appendPath(workspaceHref("/dispatch", null, env), "overview");
}

export function dispatchAppsHref(
  apps: OrgSwitcherAppLink[],
  env: RuntimeEnv = runtimeEnv(),
): string {
  const dispatch = apps.find((app) => app.isDispatch);
  if (dispatch) return appendPath(dispatchBaseHref(dispatch.href), "apps");
  return appendPath(workspaceHref("/dispatch", null, env), "apps");
}

export function visibleOrgAppLinks(
  apps: OrgSwitcherAppLink[],
  max = ORG_SWITCHER_MAX_APP_LINKS,
): VisibleOrgAppLinks {
  const links = sortAppLinks(apps).slice(0, max);
  return {
    links,
    overflowCount: Math.max(0, apps.length - links.length),
  };
}

function initialWorkspaceLinks(env: RuntimeEnv): OrgSwitcherAppLink[] {
  return (
    parseWorkspaceAppLinksJson(
      envString(env, "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON"),
      env,
    ) ?? [
      {
        id: DISPATCH_ID,
        name: "Dispatch",
        href: appendPath(workspaceHref("/dispatch", null, env), "overview"),
        description: "Workspace hub",
        icon: getTemplate(DISPATCH_ID)?.icon,
        isDispatch: true,
        status: "ready",
      },
    ]
  );
}

function workspaceAppFetchUrls(env: RuntimeEnv): string[] {
  const urls: string[] = [];
  const gatewayUrl = envString(env, "VITE_WORKSPACE_GATEWAY_URL");
  if (gatewayUrl) {
    try {
      urls.push(
        new URL(
          "/_workspace/apps",
          `${stripTrailingSlash(gatewayUrl)}/`,
        ).toString(),
      );
    } catch {
      // Fall through to the same-origin Dispatch action below.
    }
  }
  urls.push(
    "/_agent-native/actions/list-workspace-apps?includeAgentCards=false",
  );
  return urls;
}

export interface UseOrgSwitcherAppLinksResult {
  apps: OrgSwitcherAppLink[];
  isWorkspace: boolean;
  isLoading: boolean;
  dispatchHref: string;
  dispatchAllAppsHref: string;
}

export function useOrgSwitcherAppLinks(
  enabled: boolean,
): UseOrgSwitcherAppLinksResult {
  const env = useMemo(() => runtimeEnv(), []);
  const isWorkspace = useMemo(() => isWorkspaceAppEnvironment(env), [env]);
  const [apps, setApps] = useState<OrgSwitcherAppLink[]>(() =>
    isWorkspace ? initialWorkspaceLinks(env) : defaultOrgAppLinks(),
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !isWorkspace) return;
    let cancelled = false;

    async function refresh() {
      setIsLoading(true);
      try {
        for (const url of workspaceAppFetchUrls(env)) {
          try {
            const response = await fetch(url, {
              credentials: "include",
              headers: { accept: "application/json" },
            });
            if (!response.ok) continue;
            const parsed = await response.json().catch(() => null);
            const links = parseWorkspaceAppLinks(parsed, env);
            if (links?.length) {
              if (!cancelled) setApps(links);
              return;
            }
          } catch {
            // Try the next source; the static manifest remains available.
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [enabled, env, isWorkspace]);

  return {
    apps,
    isWorkspace,
    isLoading,
    dispatchHref: dispatchOverviewHref(apps, env),
    dispatchAllAppsHref: dispatchAppsHref(apps, env),
  };
}
