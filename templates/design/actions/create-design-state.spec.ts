import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    inMutation: false,
    events: [] as string[],
    insertedValues: null as Record<string, unknown> | null,
  };
  const insertQuery = {
    values: vi.fn(async (values: Record<string, unknown>) => {
      state.insertedValues = values;
      state.events.push("insert");
    }),
  };
  const tx = { insert: vi.fn(() => insertQuery) };
  type Transaction = typeof tx;
  const assertAccess = vi.fn(async () => {
    state.events.push(state.inMutation ? "access-inside" : "access-outside");
    return { role: "editor", resource: {} };
  });
  const withDesignSourceMutationTransaction = vi.fn(
    async (
      _designId: string,
      callback: (transaction: Transaction) => Promise<unknown>,
    ) => {
      state.events.push("lock");
      state.inMutation = true;
      try {
        return await callback(tx);
      } finally {
        state.inMutation = false;
      }
    },
  );

  return {
    assertAccess,
    insertQuery,
    state,
    tx,
    withDesignSourceMutationTransaction,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

vi.mock("../server/db/index.js", () => ({
  schema: {
    designState: { id: "designState.id" },
  },
}));

vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

vi.mock("nanoid", () => ({ nanoid: () => "test_id_123" }));

import { CAPTURE_DATA_MAX_BYTES } from "../shared/capture-sanitize.js";
import action from "./create-design-state.js";

beforeEach(() => {
  mocks.state.inMutation = false;
  mocks.state.events.length = 0;
  mocks.state.insertedValues = null;
  mocks.assertAccess.mockClear();
  mocks.insertQuery.values.mockClear();
  mocks.tx.insert.mockClear();
  mocks.withDesignSourceMutationTransaction.mockClear();
});

describe("create-design-state XSS sanitization", () => {
  it("sanitizes script tags in captureData before persisting", async () => {
    await action.run({
      designId: "design_1",
      name: "Test state",
      kind: "capture",
      breakpoint: "auto",
      captureData: { domHtml: '<script>alert("xss")</script><p>hi</p>' },
    });

    expect(mocks.state.insertedValues).not.toBeNull();
    const stored = mocks.state.insertedValues!.captureData as string;
    expect(stored).not.toContain("<script");
    expect(stored).toContain("<p>hi</p>");
  });

  it("sanitizes on* handlers in fixtureData before persisting", async () => {
    await action.run({
      designId: "design_1",
      name: "Fixture state",
      kind: "fixture",
      breakpoint: "desktop",
      fixtureData: { template: '<div onclick="steal()">click</div>' },
    });

    expect(mocks.state.insertedValues).not.toBeNull();
    const stored = mocks.state.insertedValues!.fixtureData as string;
    expect(stored).not.toContain("onclick");
    expect(stored).toContain("<div");
  });

  it("sanitizes javascript: href in captureData", async () => {
    await action.run({
      designId: "design_1",
      name: "Malicious link state",
      kind: "state",
      breakpoint: "auto",
      captureData: { html: '<a href="javascript:void(0)">link</a>' },
    });

    expect(mocks.state.insertedValues).not.toBeNull();
    const stored = mocks.state.insertedValues!.captureData as string;
    expect(stored).not.toContain("javascript:");
  });

  it("leaves plain data strings in captureData untouched", async () => {
    await action.run({
      designId: "design_1",
      name: "Plain data",
      kind: "fixture",
      breakpoint: "auto",
      captureData: { route: "/dashboard", userId: "u_123" },
    });

    expect(mocks.state.insertedValues).not.toBeNull();
    const stored = JSON.parse(
      mocks.state.insertedValues!.captureData as string,
    ) as Record<string, unknown>;
    expect(stored.route).toBe("/dashboard");
    expect(stored.userId).toBe("u_123");
  });
});

describe("create-design-state size cap", () => {
  it("throws when captureData exceeds the size limit", async () => {
    const bigString = "x".repeat(CAPTURE_DATA_MAX_BYTES + 1);
    await expect(
      action.run({
        designId: "design_1",
        name: "Huge state",
        kind: "capture",
        breakpoint: "auto",
        captureData: { blob: bigString },
      }),
    ).rejects.toThrow(/exceeds the.*KB limit/i);
  });

  it("throws when fixtureData exceeds the size limit", async () => {
    const bigString = "x".repeat(CAPTURE_DATA_MAX_BYTES + 1);
    await expect(
      action.run({
        designId: "design_1",
        name: "Huge fixture",
        kind: "fixture",
        breakpoint: "auto",
        fixtureData: { blob: bigString },
      }),
    ).rejects.toThrow(/exceeds the.*KB limit/i);
  });

  it("accepts a payload right at the size limit", async () => {
    const envelope = '{"blob":""}';
    const padding =
      CAPTURE_DATA_MAX_BYTES - Buffer.byteLength(envelope, "utf8");
    const borderlineString = "a".repeat(padding);

    await expect(
      action.run({
        designId: "design_1",
        name: "Borderline state",
        kind: "capture",
        breakpoint: "auto",
        captureData: { blob: borderlineString },
      }),
    ).resolves.toBeDefined();
  });

  it("rechecks editor access inside the source mutation lock before insertion", async () => {
    await action.run({
      designId: "design_1",
      name: "Locked state",
      breakpoint: "auto",
    });

    expect(mocks.withDesignSourceMutationTransaction).toHaveBeenCalledWith(
      "design_1",
      expect.any(Function),
    );
    expect(mocks.state.events).toEqual([
      "access-outside",
      "lock",
      "access-inside",
      "insert",
    ]);
  });
});
