import { createCoreRoutesPlugin } from "@agent-native/core/server";

export function resolveDesignOpenPath({
  view,
  params,
}: {
  view?: string;
  params: Record<string, string>;
}): string | null {
  if (params.designId) {
    return params.screen
      ? `/design/${params.designId}?editorView=overview&screen=${params.screen}`
      : `/design/${params.designId}`;
  }
  if (view === "editor") return "/home";
  return null;
}

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  resolveOpenPath: resolveDesignOpenPath,
  allowUnauthenticatedOpen: ({ target }) => {
    const path = target.split(/[?#]/, 1)[0] ?? "/";
    return path.startsWith("/design/");
  },
});
