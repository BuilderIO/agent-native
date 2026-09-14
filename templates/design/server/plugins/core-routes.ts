import { createCoreRoutesPlugin } from "@agent-native/core/server";

// Land external-agent deep links straight on the real SPA route. Every
// design `link` builder (generate-design, apply-tweaks, get-design-snapshot,
// export-coding-handoff) emits `view: "editor"` + `params.designId`. Without
// a resolveOpenPath, `/_agent-native/open?app=design&view=editor&designId=…`
// falls back to `/<view>` = `/editor`, which has no matching route (the
// editor route is `design.$id.tsx` → `/design/:id`) and 404s — so an
// "Open in Design" link for a connected external agent never opened the design.
export function resolveDesignOpenPath({
  view,
  params,
}: {
  view?: string;
  params: Record<string, string>;
}): string | null {
  if (params.designId) {
    // A `screen` param (a saved file id) lands on the overview canvas
    // focused on that screen instead of the bare design — see
    // `designEditorCommandFromSearchParams`, which reads these same two
    // query params on the `/design/:id` route itself.
    return params.screen
      ? `/design/${params.designId}?view=overview&screen=${params.screen}`
      : `/design/${params.designId}`;
  }
  // `editor`/unknown with no id: there is no bare `/editor` route — send to
  // the private app entry rather than 404 (the polled `navigate` command still
  // applies any record focus once the SPA is loaded).
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
