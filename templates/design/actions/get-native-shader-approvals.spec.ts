import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: true,
  approval: null as Record<string, unknown> | null,
}));
vi.mock("../server/db/index.js", () => ({}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(async () =>
    state.allowed ? { resource: { id: "design" } } : null,
  ),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => state.approval),
}));

import { readAppState } from "@agent-native/core/application-state";

import action from "./get-native-shader-approvals";

const hash = "a".repeat(64);
beforeEach(() => {
  state.allowed = true;
  state.approval = null;
  vi.clearAllMocks();
});

describe("native shader preview approvals", () => {
  it("reads only the current caller's stored approval state after checking design access", async () => {
    state.approval = { schemaVersion: 1, hashes: [hash] };
    await expect(action.run({ designId: "design" })).resolves.toEqual({
      designId: "design",
      approvedDefinitionHashes: [hash],
    });
    expect(readAppState).toHaveBeenCalledWith(
      "design-native-effect-approvals:design",
    );
    state.allowed = false;
    vi.mocked(readAppState).mockClear();
    await expect(action.run({ designId: "design" })).rejects.toMatchObject({
      errorCode: "not_found",
    });
    expect(readAppState).not.toHaveBeenCalled();
  });

  it("distinguishes absent approvals from unreadable approvals", async () => {
    await expect(action.run({ designId: "design" })).resolves.toEqual({
      designId: "design",
      approvedDefinitionHashes: [],
    });
    state.approval = { schemaVersion: 1, hashes: ["invalid"] };
    await expect(action.run({ designId: "design" })).rejects.toMatchObject({
      errorCode: "native_effect_approvals_unreadable",
    });
  });
});
