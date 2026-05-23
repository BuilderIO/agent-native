import { createCoreRoutesPlugin } from "@agent-native/core/server";

/**
 * Resolve external-agent deep links (Claude Code, Codex, Cursor, etc.) to
 * the right SPA route. Every Workbench action's `link` builder uses
 * `view: "queue" | "prs" | "pr" | "runs" | "run" | "extensions"
 * | "extension" | "settings"` with optional params. Params arrive as strings
 * from the URL query string. The legacy `tools` / `tool` aliases are still
 * accepted for backward compat with anything that hardcoded them.
 */
export default createCoreRoutesPlugin({
  resolveOpenPath: ({ view, params }) => {
    switch (view) {
      case "queue":
        return "/";
      case "prs":
        return "/prs";
      case "pr": {
        const owner = params.owner;
        const repo = params.repo;
        const num = params.pullRequest ?? params.n ?? params.number;
        if (owner && repo && num) {
          return `/prs/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo,
          )}/${encodeURIComponent(num)}`;
        }
        return "/prs";
      }
      case "runs":
        return "/runs";
      case "run":
        return params.runId
          ? `/runs/${encodeURIComponent(params.runId)}`
          : "/runs";
      case "extensions":
      case "tools":
        return "/extensions";
      case "extension":
      case "tool": {
        const id = params.extensionId ?? params.toolId;
        return id ? `/extensions/${encodeURIComponent(id)}` : "/extensions";
      }
      case "settings":
        return "/settings";
      default:
        return null;
    }
  },
});
