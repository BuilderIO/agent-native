import { beforeEach, describe, expect, it, vi } from "vitest";

type Member = { memberId: string; email: string; name: string };
type Page = { members: Member[]; nextCursor: string | null };

const model = vi.hoisted(() => ({
  pages: new Map<string | undefined, Page>(),
  cursors: [] as (string | undefined)[],
}));

vi.mock("../server/model/notebook-execution/service.js", () => ({
  currentExecutionActor: async () => ({
    orgId: "org",
    ownerEmail: "owner@example.com",
    caller: "test",
  }),
}));

vi.mock("../server/model/published-app-schedules.js", () => ({
  listPublishedAppScheduleRecipients: async (
    _actor: unknown,
    input: { cursor?: string },
  ) => {
    model.cursors.push(input.cursor);
    return model.pages.get(input.cursor) ?? { members: [], nextCursor: null };
  },
}));

import action from "./list-published-app-schedule-recipients";

const member = (id: string, name = id): Member => ({
  memberId: id,
  email: `${id}@example.com`,
  name,
});

function run(input: { cursor?: string; limit?: number; search?: string }) {
  return action.run(
    { projectId: "project", limit: 25, ...input } as never,
    {
      caller: "frontend",
    } as never,
  ) as Promise<Page>;
}

describe("list-published-app-schedule-recipients", () => {
  beforeEach(() => {
    model.pages = new Map();
    model.cursors = [];
  });

  it("keeps scanning past a page whose members cannot read the app", async () => {
    model.pages.set(undefined, { members: [], nextCursor: "m25" });
    model.pages.set("m25", {
      members: [member("m30"), member("m31")],
      nextCursor: null,
    });

    const result = await run({});

    expect(result.members.map(({ memberId }) => memberId)).toEqual([
      "m30",
      "m31",
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it("never returns more than the requested limit and resumes after the last member", async () => {
    model.pages.set(undefined, {
      members: [member("a"), member("b")],
      nextCursor: "b2",
    });
    model.pages.set("b2", {
      members: [member("c"), member("d")],
      nextCursor: "d2",
    });

    const result = await run({ limit: 3 });

    expect(result.members.map(({ memberId }) => memberId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.nextCursor).toBe("c");
  });

  it("stops scanning once the directory is exhausted", async () => {
    model.pages.set(undefined, { members: [member("a")], nextCursor: null });

    const result = await run({});

    expect(result.members).toHaveLength(1);
    expect(model.cursors).toEqual([undefined]);
  });

  it("bounds the scan and hands back a cursor when nothing eligible is found", async () => {
    for (let index = 0; index < 100; index += 1)
      model.pages.set(index ? `c${index - 1}` : undefined, {
        members: [],
        nextCursor: `c${index}`,
      });

    const result = await run({});

    expect(result.members).toEqual([]);
    expect(result.nextCursor).not.toBeNull();
    expect(model.cursors.length).toBeLessThan(20);
  });

  it("labels a member with a blank directory name by their email", async () => {
    model.pages.set(undefined, {
      members: [member("a", "   "), member("b", "")],
      nextCursor: null,
    });

    const result = await run({});

    expect(result.members.map(({ name }) => name)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});
