
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

let insertedValues: Record<string, unknown> | null = null;

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return Promise.resolve();
      },
    }),
  }),
  schema: {
    designState: {},
  },
}));

vi.mock("nanoid", () => ({ nanoid: () => "test_id_123" }));

import { CAPTURE_DATA_MAX_BYTES } from "../shared/capture-sanitize.js";
import action from "./create-design-state.js";

beforeEach(() => {
  insertedValues = null;
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

    expect(insertedValues).not.toBeNull();
    const stored = insertedValues!.captureData as string;
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

    expect(insertedValues).not.toBeNull();
    const stored = insertedValues!.fixtureData as string;
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

    expect(insertedValues).not.toBeNull();
    const stored = insertedValues!.captureData as string;
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

    expect(insertedValues).not.toBeNull();
    const stored = JSON.parse(insertedValues!.captureData as string) as Record<
      string,
      unknown
    >;
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
});
