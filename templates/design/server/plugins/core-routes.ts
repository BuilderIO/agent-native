import { createCoreRoutesPlugin } from "@agent-native/core/server";

// Land external-agent deep links straight on the real SPA route. Every
// design `link` builder (generate-design, apply-tweaks, get-design-snapshot,
// export-coding-handoff) emits `view: "editor"` + `params.designId`. Without
// a resolveOpenPath, `/_agent-native/open?app=design&view=editor&designId=…`
// falls back to `/<view>` = `/editor`, which has no matching route (the
// editor route is `design.$id.tsx` → `/design/:id`) and 404s — so an
// "Open in Design" link for a connected external agent never opened the design.
export default createCoreRoutesPlugin({
  resolveOpenPath: ({ view, params }) => {
    if (params.designId) return `/design/${params.designId}`;
    // `editor`/unknown with no id: there is no bare `/editor` route — send to
    // the app root rather than 404 (the polled `navigate` command still
    // applies any record focus once the SPA is loaded).
    if (view === "editor") return "/";
    return null;
  },
  allowUnauthenticatedOpen: ({ target }) => {
    const path = target.split(/[?#]/, 1)[0] ?? "/";
    return path.startsWith("/design/");
  },
});
