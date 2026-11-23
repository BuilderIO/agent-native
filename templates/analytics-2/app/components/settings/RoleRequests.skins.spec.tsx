// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { referenceDesignSystem } from "@/skins/reference/design-system";
import { click, mount, settle } from "@/skins/reference/testing/mount";
import {
  SKINS,
  partControl,
  rowControl,
  tagged,
} from "@/skins/reference/testing/skins";
import { createSkinHarness, type SkinCase } from "@/testing/settings/skins";

import { roleRequest, roleRequests } from "./RoleRequests.fixtures";

const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./RoleRequests.fixtures")).roleRequestHooksMock,
}));

const { RoleRequestControl, RoleRequestQueue } = await import("./RoleRequests");

const ACCESS = "settings.profile.request-admin-access";
const QUEUE = "settings.users.role-requests";

const request = (root: ParentNode) => rowControl(root, ACCESS);
const decide = (root: ParentNode, decision: string, key: string) =>
  partControl(
    root,
    `${QUEUE}.item.${decision}`,
    "settings.collection.action",
    key,
  );

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  "control.member": {
    arrange: () => roleRequests.reset(),
    ui: () => <RoleRequestControl />,
  },
  "control.pending": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.requests = [
        roleRequest("role-request-1", "me@example.test"),
      ];
    },
    ui: () => <RoleRequestControl />,
  },
  "control.admin": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.isAdmin = true;
    },
    ui: () => <RoleRequestControl />,
  },
  "control.filed": {
    arrange: () => roleRequests.reset(),
    ui: () => <RoleRequestControl />,
    drive: async ({ container }) => {
      click(request(container));
      await settle();
    },
  },
  "control.error": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.callAction.mockRejectedValueOnce(
        new Error("Role requests are closed."),
      );
    },
    ui: () => <RoleRequestControl />,
    drive: async ({ container }) => {
      click(request(container));
      await settle();
    },
  },
  "queue.loading": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.loading = true;
    },
    ui: () => <RoleRequestQueue />,
  },
  "queue.empty": {
    arrange: () => roleRequests.reset(),
    ui: () => <RoleRequestQueue />,
  },
  "queue.ready": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.requests = [
        roleRequest("role-request-1", "ada@example.test"),
        roleRequest("role-request-2", "grace@example.test"),
        roleRequest("role-request-3", "old@example.test", "approved"),
      ];
    },
    ui: () => <RoleRequestQueue />,
  },
  "queue.decided": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.requests = [
        roleRequest("role-request-3", "old@example.test", "approved"),
        roleRequest("role-request-4", "older@example.test", "declined"),
      ];
    },
    ui: () => <RoleRequestQueue />,
  },
  "queue.error": {
    arrange: () => {
      roleRequests.reset();
      roleRequests.requests = [
        roleRequest("role-request-1", "ada@example.test"),
      ];
      roleRequests.callAction.mockRejectedValueOnce(
        new Error("Only an administrator can decide."),
      );
    },
    ui: () => <RoleRequestQueue />,
    drive: async ({ container }) => {
      click(decide(container, "approve", "role-request-1"));
      await settle();
    },
  },
};

describe("role requests, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    expect(await skinDifferences(STATES[name]!)).toEqual([]);
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(() => roleRequests.reset());

    it("approves and declines from the queue by item key", async () => {
      roleRequests.requests = [
        roleRequest("role-request-1", "ada@example.test"),
        roleRequest("role-request-2", "grace@example.test"),
      ];
      const mounted = mount(<RoleRequestQueue />, skin);
      try {
        expect(
          tagged(
            mounted.container,
            `${QUEUE}.item`,
            "settings.collection.item",
            "role-request-2",
          ).textContent,
        ).toContain("grace@example.test");
        click(decide(mounted.container, "approve", "role-request-2"));
        await settle();
        expect(roleRequests.callAction).toHaveBeenLastCalledWith(
          "resolve-role-request",
          { id: "role-request-2", decision: "approved" },
        );
        click(decide(mounted.container, "decline", "role-request-1"));
        await settle();
        expect(roleRequests.callAction).toHaveBeenLastCalledWith(
          "resolve-role-request",
          { id: "role-request-1", decision: "declined" },
        );
        expect(roleRequests.refetch).toHaveBeenCalledTimes(2);
      } finally {
        mounted.unmount();
      }
    });

    it("shows the message of a decision that was not saved", async () => {
      roleRequests.requests = [
        roleRequest("role-request-1", "ada@example.test"),
      ];
      roleRequests.callAction.mockRejectedValueOnce(
        new Error("Only an administrator can decide."),
      );
      const mounted = mount(<RoleRequestQueue />, skin);
      try {
        click(decide(mounted.container, "approve", "role-request-1"));
        await settle();
        expect(
          tagged(mounted.container, QUEUE, "settings.row.error").textContent,
        ).toContain("Only an administrator can decide.");
      } finally {
        mounted.unmount();
      }
    });

    it("files a request for admin access from the member's row", async () => {
      const mounted = mount(<RoleRequestControl />, skin);
      try {
        expect(request(mounted.container).hasAttribute("disabled")).toBe(false);
        click(request(mounted.container));
        await settle();
        expect(roleRequests.callAction).toHaveBeenCalledWith("request-role", {
          requestedRole: "admin",
        });
        expect(request(mounted.container).hasAttribute("disabled")).toBe(true);
      } finally {
        mounted.unmount();
      }
    });
  });
});
