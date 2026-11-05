import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resourceListAccessible: vi.fn() }));

vi.mock("../../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  ensurePersonalDefaults: vi.fn(async () => undefined),
  isWorkspaceResourceOwner: (owner: string) => owner === "__workspace__",
  sharedResourceOwner: () => "__shared__",
  resourceList: vi.fn(),
  resourceListAccessible: (...args: unknown[]) =>
    mocks.resourceListAccessible(...args),
}));

import { runWithRequestContext } from "../../server/request-context.js";
import resourceListScript from "./list.js";

const owner = "alice@example.test";

afterEach(() => vi.restoreAllMocks());

it("continues past the default page size using the returned offset", async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({
    owner,
    path: `skills/s-${String(i).padStart(3, "0")}.md`,
    mimeType: "text/markdown",
    size: 1,
  }));
  mocks.resourceListAccessible.mockResolvedValue(rows);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const run = (args: string[]) =>
    runWithRequestContext({ userEmail: owner }, () => resourceListScript(args));

  await run(["--format", "json"]);
  const first = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  expect(first.resources).toHaveLength(200);
  expect(first.total).toBe(201);
  expect(first.hasMore).toBe(true);
  expect(first.nextOffset).toBe(200);

  await run(["--format", "json", "--offset", String(first.nextOffset)]);
  const last = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  expect(
    last.resources.map((resource: { path: string }) => resource.path),
  ).toEqual(["skills/s-200.md"]);
  expect(last.hasMore).toBe(false);
  expect(last.nextOffset).toBeNull();
});
