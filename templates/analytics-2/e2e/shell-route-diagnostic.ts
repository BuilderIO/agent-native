export type ShellRouteDiagnostic = {
  route: "project" | "home" | "other" | "unknown";
  matchesExpected: boolean;
};

export function shellRouteDiagnostic(
  pageUrl: string,
  base: string,
  projectId: string,
): ShellRouteDiagnostic {
  let page: URL;
  let app: URL;
  try {
    page = new URL(pageUrl);
    app = new URL(base);
  } catch {
    return { route: "unknown", matchesExpected: false };
  }
  const prefix = app.pathname.replace(/\/$/, "");
  if (page.origin !== app.origin || !page.pathname.startsWith(`${prefix}/`)) {
    return { route: "unknown", matchesExpected: false };
  }
  const segments = page.pathname
    .slice(prefix.length)
    .split("/")
    .filter(Boolean);
  if (segments[0] === "project" && segments[1])
    return {
      route: "project",
      matchesExpected: decodeURIComponent(segments[1]) === projectId,
    };
  if (segments[0] === "home") return { route: "home", matchesExpected: false };
  return { route: "other", matchesExpected: false };
}
