import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  applyOptimisticFleetMutation,
  hasFleetApps,
  qualifyFleetMutation,
  recoverFleetMutationFailure,
  reconcileVerifiedFleetMutation,
} from "./FeatureFlagsFleetPanel";

describe("applyOptimisticFleetMutation", () => {
  const on = {
    version: 1 as const,
    mode: "on" as const,
    emails: [],
    orgIds: [],
    percentage: 0,
  };
  const orgOwn = {
    version: 1 as const,
    mode: "rules" as const,
    emails: ["someone@example.test"],
    orgIds: [],
    percentage: 0,
  };
  const flag = {
    key: "receiver",
    defaultValue: false,
    rules: orgOwn,
    scopes: {
      inEffect: "org" as const,
      global: { state: "unset" as const, canManage: true },
      org: {
        orgId: "org-1",
        state: "set" as const,
        rules: orgOwn,
        canManage: true,
      },
    },
  };

  it("leaves the rule in effect alone when a global change meets an org's own rule", () => {
    expect(
      applyOptimisticFleetMutation(flag, {
        key: "receiver",
        operation: "replace-rules",
        scope: "global",
        rules: on,
      }),
    ).toEqual({
      ...flag,
      scopes: {
        ...flag.scopes,
        global: { state: "set", rules: on, canManage: true },
      },
    });
  });

  it("shows an org change as the rule in effect", () => {
    const next = applyOptimisticFleetMutation(flag, {
      key: "receiver",
      operation: "off",
      scope: "org",
    });

    expect(next.rules).toMatchObject({ mode: "off", emails: [] });
    expect(next.scopes).toMatchObject({
      inEffect: "org",
      org: { state: "set", rules: { mode: "off" } },
    });
  });
});

describe("hasFleetApps", () => {
  it("keeps a local Analytics entry usable when the peer directory is unavailable", () => {
    expect(
      hasFleetApps({
        directoryStatus: "unavailable",
        apps: [{ appId: "analytics", state: "ready" }],
      }),
    ).toBe(true);
    expect(hasFleetApps({ directoryStatus: "unavailable", apps: [] })).toBe(
      false,
    );
  });
});

describe("qualifyFleetMutation", () => {
  it("preserves Core rollout rules while qualifying the target app", () => {
    const rules = {
      version: 1 as const,
      mode: "rules" as const,
      emails: ["owner@example.test"],
      orgIds: ["org-1"],
      percentage: 25,
    };

    expect(
      qualifyFleetMutation("app-1", {
        key: "new-editor",
        operation: "replace-rules",
        rules,
      }),
    ).toEqual({
      appId: "app-1",
      key: "new-editor",
      operation: "replace-rules",
      rules,
    });
  });
});

describe("reconcileVerifiedFleetMutation", () => {
  it("replaces optimistic state with the independently verified target state", () => {
    const directory = {
      directoryStatus: "available",
      apps: [
        {
          appId: "content",
          state: "ready",
          flags: [
            {
              key: "receiver",
              defaultValue: false,
              rules: { mode: "off", emails: [], orgIds: [], percentage: 0 },
            },
          ],
        },
      ],
    };
    expect(
      reconcileVerifiedFleetMutation(directory, "content", {
        contractVersion: 3,
        status: "verified",
        key: "receiver",
        rules: {
          version: 1,
          mode: "rules",
          emails: ["owner@example.test"],
          orgIds: [],
          percentage: 0,
          updatedAt: 1,
          updatedBy: "owner@example.test",
        },
        enabledForCurrentUser: true,
      }),
    ).toMatchObject({
      apps: [
        {
          flags: [
            {
              rules: { mode: "rules" },
              enabledForCurrentUser: true,
            },
          ],
        },
      ],
    });
  });

  it("takes the read-back flag whole, so a stale rule cannot survive", () => {
    const directory = {
      apps: [
        {
          appId: "content",
          flags: [
            {
              key: "receiver",
              defaultValue: false,
              rules: { mode: "on", emails: [], orgIds: [], percentage: 0 },
            },
          ],
        },
      ],
    };
    const readBack = {
      key: "receiver",
      defaultValue: false,
      scopes: {
        inEffect: "org" as const,
        global: { state: "unreadable" as const, canManage: true },
        org: { orgId: "org-1", state: "unreadable" as const, canManage: true },
      },
    };

    const [flag] = reconcileVerifiedFleetMutation(directory, "content", {
      contractVersion: 3,
      status: "verified",
      key: "receiver",
      rules: { version: 1, mode: "off", emails: [], orgIds: [], percentage: 0 },
      enabledForCurrentUser: null,
      flag: readBack,
    }).apps![0]!.flags!;

    expect(flag).toEqual(readBack);
  });

  it("restores optimistic state and refreshes after a failed mutation", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const key = ["action", "list-workspace-feature-flags", undefined] as const;
    const previous = { directoryStatus: "available", apps: [] };

    recoverFleetMutationFailure(client, { previous, key });

    expect(client.getQueryData(key)).toEqual(previous);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-workspace-feature-flags"],
    });
  });
});
