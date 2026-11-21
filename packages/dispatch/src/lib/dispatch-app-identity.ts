type DispatchAppIdentity = {
  id: string;
  name: string;
  aliases?: string[];
  source?:
    | "workspace"
    | "org-directory"
    | "remote-agent"
    | "builtin"
    | undefined;
  granted?: boolean;
};

export function matchDispatchAppCandidates<App extends DispatchAppIdentity>(
  apps: readonly App[],
  requested: string,
): App[] {
  const target = requested.trim().toLowerCase();
  if (!target) return [];
  const exact = apps.filter((app) => app.id.toLowerCase() === target);
  if (exact.length || target.includes("/")) return exact;

  const granted = apps.filter((app) => app.granted !== false);
  const qualified = granted.filter((app) =>
    app.id.toLowerCase().endsWith(`/${target}`),
  );
  const named = granted.filter((app) =>
    [app.name, ...(app.aliases ?? [])].some(
      (name) => name.trim().toLowerCase() === target,
    ),
  );
  const workspace = [...new Set([...qualified, ...named])].filter(
    (app) =>
      app.source === "workspace" ||
      app.source === "org-directory" ||
      (app.source !== "builtin" && qualified.includes(app)),
  );
  if (workspace.length) return workspace;
  return qualified.length ? qualified : named;
}
