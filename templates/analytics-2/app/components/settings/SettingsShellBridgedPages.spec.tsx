// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: { features: { isAdmin: access.isAdmin } },
  }),
}));

/**
 * sprint-analytics-2#153: the shared org pages read the settings shell's context, so
 * mounting them raw in this app's own rail threw "useSettingsShell must be used
 * inside the Settings shell" and every one of those tabs rendered
 * "Something went wrong". Each bridged page must supply that context for the page it
 * mounts. The three pages are replaced here by one that asks for the context exactly
 * the way the real ones do, so the check fails if the provider goes away.
 */
vi.mock("@agent-native/toolkit/app/org", async () => {
  const { useSettingsShell, useSettingsPageHeader } =
    await import("@agent-native/toolkit/app/settings/shell");
  const probe = (name: string) => () => {
    const context = useSettingsShell();
    // The member surface puts "Invite members" in the page header; a bridge that
    // drops it leaves the invite promise with no control (sprint-analytics-2#153).
    useSettingsPageHeader({
      action: <button type="button">Invite members</button>,
    });
    return <p>{`${name}:${context.route.page ?? "none"}`}</p>;
  };
  return {
    OrgMembersPage: probe("members"),
    OrgAuthenticationPage: probe("auth"),
    OrgGeneralPage: probe("org"),
  };
});

import {
  AuthenticationSettingsPage,
  OrganizationSettingsPage,
  UsersSettingsPage,
} from "./SettingsShellBridgedPages";

describe("settings shell bridge", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    access.isAdmin = true;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const render = (Page: () => ReactElement) =>
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <Page />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

  it("supplies the shell context each shared page reads", () => {
    render(UsersSettingsPage);
    expect(host.textContent).toContain("members");
    render(AuthenticationSettingsPage);
    expect(host.textContent).toContain("auth");
    render(OrganizationSettingsPage);
    expect(host.textContent).toContain("org");
  });

  it("bridges the Users page too, because it mounts the member surface itself", () => {
    render(UsersSettingsPage);
    expect(host.textContent).toContain("members");
  });

  it("renders the header action a shared page sets, so Invite members exists", () => {
    render(UsersSettingsPage);
    const action = host.querySelector("[data-settings-action]");
    expect(action).not.toBeNull();
    expect(action?.textContent).toContain("Invite members");
    expect(host.querySelector("button")?.textContent).toContain(
      "Invite members",
    );
  });

  it("keeps the Users member surface read-only even when the shared page offers invites", () => {
    access.isAdmin = false;
    render(UsersSettingsPage);
    expect(host.textContent).toContain("members");
    expect(host.querySelector("[data-settings-action]")).toBeNull();
    expect(host.textContent).not.toContain("Invite members");
  });

  it("reports the page the rail opened, not a fixed one", () => {
    render(AuthenticationSettingsPage);
    expect(host.textContent).toContain("auth:auth");
    render(OrganizationSettingsPage);
    expect(host.textContent).toContain("org:org");
  });
});
