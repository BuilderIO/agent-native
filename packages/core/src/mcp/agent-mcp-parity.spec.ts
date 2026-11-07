import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  BASELINE_PATH,
  readParityGaps,
} from "../../../../scripts/guard-no-new-mcp-parity-gaps.js";
import {
  LOAD_TIMEOUT_MS,
  baselineSection,
  loadAppCatalogs,
  undecidedMcpActions,
  type AppCatalog,
} from "./advertised-catalog.harness.js";

// The guard and this spec read the baseline through the same function, so the
// list the guard compares with the base branch is the list checked here.
const GAPS = readParityGaps(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);

let apps: AppCatalog[] = [];

function undecidedIds(): Set<string> {
  const ids = new Set<string>();
  for (const app of apps) {
    for (const name of undecidedMcpActions(app)) {
      ids.add(`${baselineSection(app, name)}/${name}`);
    }
  }
  return ids;
}

// An outside agent connected to an app can call only what the app serves over
// MCP, so every action the app's own agent can call needs a decision: served,
// or kept in-app with a reason. This holds new actions to that and lets the
// baseline of actions that predate the check only shrink.
describe("MCP parity with each app's own agent", () => {
  beforeAll(async () => {
    apps = await loadAppCatalogs();
  }, LOAD_TIMEOUT_MS);

  it("has a section for every app, plus core, and nothing else", () => {
    expect(apps.length).toBeGreaterThan(10);
    expect(Object.keys(GAPS).sort()).toEqual(
      [...apps.map((app) => app.appId), "core"].sort(),
    );
  });

  it("requires an MCP decision for every action an app's own agent can call", () => {
    const missing = [...undecidedIds()]
      .filter((id) => {
        const [section, name] = id.split("/") as [string, string];
        return !GAPS[section]?.includes(name);
      })
      .sort();
    expect(
      missing,
      "The app's own agent can call these actions, but outside agents connected over MCP cannot, and nothing says why. " +
        "Decide each one on its action: `mcpTool: true` serves it to outside agents (add a test that calls it over MCP), " +
        "and `mcpTool: false` keeps it in-app, with a comment on that line saying why (it needs the open screen or the in-app chat, " +
        "it changes credentials or settings, it is maintenance tooling). " +
        `Do not add them to ${BASELINE_PATH}: that baseline may only shrink (guard:no-new-mcp-parity-gaps rejects added ids).`,
    ).toEqual([]);
  });

  it("keeps the baseline limited to actions that are still undecided", () => {
    const undecided = undecidedIds();
    const stale = Object.entries(GAPS).flatMap(([section, names]) =>
      names
        .filter((name) => !undecided.has(`${section}/${name}`))
        .map((name) => `${section}/${name}`),
    );
    expect(
      stale,
      `These ${BASELINE_PATH} entries name an action that was removed, is served, declares mcpTool, or is ruled out by the framework. Delete them.`,
    ).toEqual([]);
  });

  it("lists each action once, sorted", () => {
    for (const [section, names] of Object.entries(GAPS)) {
      expect(names, section).toEqual([...new Set(names)].sort());
    }
  });
});
