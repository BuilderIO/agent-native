// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  buttonByText,
  click,
  mount,
  settle,
  type Mounted,
} from "@/skins/reference/testing/mount";

import { roleRequest, roleRequests } from "./RoleRequests.fixtures";

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./RoleRequests.fixtures")).roleRequestHooksMock,
}));

const { RoleRequestControl, RoleRequestQueue } = await import("./RoleRequests");

describe("role requests, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => roleRequests.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/RoleRequests.${state}.html`,
    );

  it("control: a member with no request", async () => {
    mounted = mount(<RoleRequestControl />);
    await golden("control.member");
  });

  it("control: a member whose request is pending", async () => {
    roleRequests.requests = [roleRequest("role-request-1", "me@example.test")];
    mounted = mount(<RoleRequestControl />);
    await golden("control.pending");
  });

  it("control: an administrator", async () => {
    roleRequests.isAdmin = true;
    mounted = mount(<RoleRequestControl />);
    await golden("control.admin");
  });

  it("control: after the request is filed", async () => {
    mounted = mount(<RoleRequestControl />);
    click(buttonByText(mounted.container, "Request admin access"));
    await settle();
    expect(roleRequests.callAction).toHaveBeenCalledWith("request-role", {
      requestedRole: "admin",
    });
    await golden("control.filed");
  });

  it("control: the request was not saved", async () => {
    roleRequests.callAction.mockRejectedValueOnce(
      new Error("Role requests are closed."),
    );
    mounted = mount(<RoleRequestControl />);
    click(buttonByText(mounted.container, "Request admin access"));
    await settle();
    await golden("control.error");
  });

  it("queue: loading", async () => {
    roleRequests.loading = true;
    mounted = mount(<RoleRequestQueue />);
    await golden("queue.loading");
  });

  it("queue: nothing open", async () => {
    mounted = mount(<RoleRequestQueue />);
    await golden("queue.empty");
  });

  it("queue: open requests and one decided", async () => {
    roleRequests.requests = [
      roleRequest("role-request-1", "ada@example.test"),
      roleRequest("role-request-2", "grace@example.test"),
      roleRequest("role-request-3", "old@example.test", "approved"),
    ];
    mounted = mount(<RoleRequestQueue />);
    await golden("queue.ready");
  });

  it("queue: nothing open and several decided", async () => {
    roleRequests.requests = [
      roleRequest("role-request-3", "old@example.test", "approved"),
      roleRequest("role-request-4", "older@example.test", "declined"),
    ];
    mounted = mount(<RoleRequestQueue />);
    await golden("queue.decided");
  });

  it("queue: a decision was not saved", async () => {
    roleRequests.requests = [roleRequest("role-request-1", "ada@example.test")];
    roleRequests.callAction.mockRejectedValueOnce(
      new Error("Only an administrator can decide."),
    );
    mounted = mount(<RoleRequestQueue />);
    click(buttonByText(mounted.container, "Approve"));
    await settle();
    expect(roleRequests.callAction).toHaveBeenCalledWith(
      "resolve-role-request",
      { id: "role-request-1", decision: "approved" },
    );
    await golden("queue.error");
  });
});
