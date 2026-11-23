import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hasRoutePage } from "@/components/workspace/pages";

import { resolveRoute } from "../../routes/routing/registry";

/**
 * Every destination the sidebar draws is a click a tester makes in their first minute.
 * Three times this sprint a nav row pointed at a route with no page (Trash, Archive,
 * Tasks), and each time the reader got an empty frame. This pins the whole sidebar:
 * every `to="..."` in WorkspaceShell must resolve to a registered page, or be named on
 * the pending list below with the reason it cannot be wired yet.
 */
const SHELL = new URL("./WorkspaceShell.tsx", import.meta.url).pathname;

/** Nav rows whose surface is not built yet. Wiring one must delete its entry here. */
const PENDING: Record<string, string> = {
  "/home/tasks":
    "no route of its own: /home/tasks falls back to Home, so the row lands on the dashboard; rebuild-owned",
  "/home/folders": "folders has no page in the rebuilt app yet; rebuild-owned",
  "/home/drafts": "drafts has no page in the rebuilt app yet; rebuild-owned",
};

function navPaths(): string[] {
  const source = readFileSync(SHELL, "utf8");
  const paths = new Set<string>();
  for (const match of source.matchAll(/to="(\/[a-zA-Z0-9/_-]*)"/g)) {
    paths.add(match[1]!);
  }
  return [...paths].sort();
}

function opensAPage(path: string): boolean {
  const route = resolveRoute(path);
  // A nav path that does not match any route falls back to the home route, which
  // would otherwise look like a registered page. `/home/tasks` did exactly that and
  // landed the reader on Home, so the fallback only counts for "/home" itself.
  if (route.id === "home" && route.view === "home" && path !== "/home") {
    return false;
  }
  return hasRoutePage(route.id, route.view);
}

describe("workspace sidebar", () => {
  it("only links to pages that exist, or names the gap", () => {
    const dead = navPaths().filter(
      (path) => !opensAPage(path) && !(path in PENDING),
    );
    expect(dead, `nav rows that open nothing: ${dead.join(", ")}`).toEqual([]);
  });

  it("drops a pending entry once its page exists", () => {
    const stale = Object.keys(PENDING).filter((path) => opensAPage(path));
    expect(stale, `pending but wired: ${stale.join(", ")}`).toEqual([]);
  });

  it("keeps the core destinations wired", () => {
    for (const path of [
      "/home",
      "/home/all",
      "/home/threads",
      "/home/archive",
      "/home/trash",
      "/settings",
    ]) {
      expect(opensAPage(path), `${path} opens nothing`).toBe(true);
    }
  });
});
