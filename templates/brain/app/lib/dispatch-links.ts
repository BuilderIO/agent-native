import {
  defaultOrgAppLinks,
  dispatchOverviewHref,
  parseWorkspaceAppLinksJson,
} from "@agent-native/core/client/org";

type RuntimeEnv = Record<string, string | boolean | undefined>;

function runtimeEnv(): RuntimeEnv {
  return (
    (
      import.meta as unknown as {
        env?: RuntimeEnv;
      }
    ).env ?? {}
  );
}

export function getDispatchHref(): string {
  const env = runtimeEnv();
  const apps =
    parseWorkspaceAppLinksJson(
      typeof env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON === "string"
        ? env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON
        : undefined,
      env,
    ) ?? defaultOrgAppLinks();
  return dispatchOverviewHref(apps, env);
}

export function dispatchIntegrationsHref(
  providerId: string,
  dispatchHref: string,
): string {
  const params = new URLSearchParams({
    provider: providerId,
    appId: "brain",
    returnTo: "ask",
  });
  const base = dispatchHref
    .replace(/\/(?:overview|apps)\/?$/, "")
    .replace(/\/$/, "");
  return `${base}/integrations?${params.toString()}`;
}
