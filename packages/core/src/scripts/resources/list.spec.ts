import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resourceList: vi.fn(),
  resourceListAccessible: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  ensurePersonalDefaults: vi.fn(async () => undefined),
  isWorkspaceResourceOwner: (owner: string) => owner === "__workspace__",
  sharedResourceOwner: () => "__shared__",
  resourceList: (...args: unknown[]) => mocks.resourceList(...args),
  resourceListAccessible: (...args: unknown[]) =>
    mocks.resourceListAccessible(...args),
}));

import { runWithRequestContext } from "../../server/request-context.js";
import resourceListScript from "./list.js";

const owner = "alice@example.test";
let output: string[];

function run(args: string[]) {
  return runWithRequestContext({ userEmail: owner }, () =>
    resourceListScript(args),
  );
}

describe("resource-list pagination", () => {
  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      output.push(String(line));
    });
    const rows = Array.from({ length: 250 }, (_, i) => ({
      owner,
      path: `skills/s-${String(249 - i).padStart(3, "0")}.md`,
      mimeType: "text/markdown",
      size: 1,
    }));
    mocks.resourceListAccessible.mockResolvedValue(rows);
  });
  afterEach(() => vi.restoreAllMocks());

  it("pages through every resource with hasMore/nextOffset", async () => {
    await run(["--format", "json", "--limit", "100"]);
    const first = JSON.parse(output.join(""));
    expect(first.resources).toHaveLength(100);
    expect(first.total).toBe(250);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(100);
    expect(first.resources[0].path).toBe("skills/s-000.md");

    output = [];
    await run(["--format", "json", "--limit", "100", "--offset", "200"]);
    const last = JSON.parse(output.join(""));
    expect(last.resources).toHaveLength(50);
    expect(last.hasMore).toBe(false);
    expect(last.nextOffset).toBeNull();
  });

  it("tells text readers how to fetch the next page", async () => {
    await run(["--limit", "10"]);
    expect(output.join("\n")).toContain(
      "Next page: --scope all --offset 10 --limit 10",
    );
  });
});
