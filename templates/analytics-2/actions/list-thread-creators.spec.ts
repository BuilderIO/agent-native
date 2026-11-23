import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: mocks.workspace,
}));

import action from "./list-thread-creators";

const run = (ownerEmails: string[]) =>
  action.run({ ownerEmails }, { appId: "analytics-2" } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({
    ownerEmail: "viewer@example.test",
    orgId: "org-1",
  });
});

it("returns the name of each requested creator who is in this workspace", async () => {
  mocks.execute.mockResolvedValue({
    rows: [
      { email: "Ada@Example.test", name: "Ada Lovelace", image: null },
      {
        email: "grace@example.test",
        name: "Grace Hopper",
        image: "https://img.example.test/grace.png",
      },
    ],
  });
  expect(await run(["ada@example.test", "grace@example.test"])).toEqual({
    creators: [
      { email: "ada@example.test", name: "Ada Lovelace", imageUrl: null },
      {
        email: "grace@example.test",
        name: "Grace Hopper",
        imageUrl: "https://img.example.test/grace.png",
      },
    ],
  });
});

it("reads every creator in one query scoped to the caller's workspace", async () => {
  mocks.execute.mockResolvedValue({ rows: [] });
  await run(["a@example.test", "b@example.test", "c@example.test"]);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  const call = mocks.execute.mock.calls.at(0)?.at(0) as {
    sql: string;
    args: unknown[];
  };
  expect(call.args).toContain("org-1");
  expect(call.args).toEqual(
    expect.arrayContaining(["a@example.test", "b@example.test"]),
  );
  expect(call.sql).toContain("org_members");
});

it("omits a creator who is not an active member and never invents a name", async () => {
  mocks.execute.mockResolvedValue({
    rows: [{ email: "ada@example.test", name: null, image: null }],
  });
  const result = await run(["ada@example.test", "gone@example.test"]);
  expect(result.creators).toEqual([
    { email: "ada@example.test", name: null, imageUrl: null },
  ]);
});

it("rejects an empty or oversized request", async () => {
  await expect(run([])).rejects.toThrow();
  await expect(
    run(Array.from({ length: 101 }, (_, i) => `u${i}@example.test`)),
  ).rejects.toThrow();
});
