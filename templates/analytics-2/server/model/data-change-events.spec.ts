import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  events: [] as unknown[],
  throwObserver: false,
}));
vi.mock("@agent-native/core/settings", () => ({
  getSettingsEmitter: () => ({
    emit: (_topic: string, event: unknown) => {
      state.events.push(event);
      if (state.throwObserver) throw new Error("Observer failure");
    },
  }),
  publishUserSettingChange: (email: string, key: string) => {
    state.events.push({ email, key });
  },
}));
import {
  afterDataCommit,
  noteOrgDataChange,
  noteUserDataChange,
} from "./data-change-events.js";
beforeEach(() => {
  state.events = [];
  state.throwObserver = false;
});
describe("committed data invalidation", () => {
  it("publishes each exact key once after the outer commit", async () => {
    const result = await afterDataCommit(async () => {
      noteOrgDataChange("workspace-a", "resource-a");
      noteOrgDataChange("workspace-a", "resource-a");
      noteUserDataChange("owner@example.test", "save-a");
      await afterDataCommit(async () => {
        noteOrgDataChange("workspace-a", "resource-b");
        expect(state.events).toEqual([]);
      });
      expect(state.events).toEqual([]);
      return "committed";
    });
    expect(result).toBe("committed");
    expect(state.events).toEqual([
      { source: "settings", type: "change", key: "o:workspace-a:resource-a" },
      { source: "settings", type: "change", key: "o:workspace-a:resource-b" },
      { email: "owner@example.test", key: "save-a" },
    ]);
  });
  it("publishes no event from a rolled back transaction", async () => {
    await expect(
      afterDataCommit(async () => {
        noteOrgDataChange("workspace-a", "resource-a");
        noteUserDataChange("owner@example.test", "save-a");
        throw new Error("Rollback");
      }),
    ).rejects.toThrow("Rollback");
    expect(state.events).toEqual([]);
  });
  it("keeps independent transaction scopes isolated", async () => {
    await Promise.all([
      afterDataCommit(async () => {
        noteOrgDataChange("workspace-a", "resource-a");
        await Promise.resolve();
      }),
      afterDataCommit(async () => {
        noteOrgDataChange("workspace-b", "resource-a");
      }),
    ]);
    expect(state.events).toHaveLength(2);
    expect(state.events).toEqual(
      expect.arrayContaining([
        { source: "settings", type: "change", key: "o:workspace-a:resource-a" },
        { source: "settings", type: "change", key: "o:workspace-b:resource-a" },
      ]),
    );
  });
  it("never reports a committed write as a rollback because an observer threw", async () => {
    state.throwObserver = true;
    await expect(
      afterDataCommit(async () => {
        noteOrgDataChange("workspace-a", "resource-a");
        noteUserDataChange("owner@example.test", "save-a");
        return "committed";
      }),
    ).resolves.toBe("committed");
    expect(state.events).toHaveLength(2);
  });
});
