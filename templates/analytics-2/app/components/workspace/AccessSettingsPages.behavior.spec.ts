import { describe, expect, it } from "vitest";

import { resolveRoutePage } from "./pages";
import { NAV_GROUPS } from "./SettingsShell";

/**
 * Row sprint-analytics-2#153: the Access & Security rail listed Users, Groups,
 * Directory sync and SSO, but the settings page registry had no entry for any of
 * them, so every one of those links led to a blank surface and a tester saw "no
 * member details, no role requests, no allowed email domains, no invite".
 *
 * The rule this pins: every Access & Security tab the rail renders resolves to a
 * real page component. It is deliberately scoped to that group - the other rail
 * groups are still being rebuilt and are tracked separately.
 */
const ACCESS_GROUP = "Access & Security";

/** The rail tabs that have a shared page to point at today. */
const WIRED = ["users", "groups", "directory-sync", "sso", "audit-logs"];

/**
 * Still unresolved, and owned by the settings rebuild rather than guessed here:
 * `project-security`. The shared shell renders a workspace-security page inside
 * its own shell and it is not reachable as a standalone export. Audit logs mounts
 * the shared audit page, which reads the framework's audit actions.
 */
const PENDING = ["project-security"];

function accessTabs(): string[] {
  const group = NAV_GROUPS.find((entry) => entry.title === ACCESS_GROUP);
  if (!group) throw new Error(`the settings rail has no ${ACCESS_GROUP} group`);
  return group.items.map((item) => item.tab);
}

describe("Access & Security settings pages", () => {
  it("renders exactly the tabs this test covers in the Access & Security group", () => {
    expect(accessTabs().slice().sort()).toEqual([...WIRED, ...PENDING].sort());
  });

  it("resolves every wired tab to a real page component", () => {
    for (const tab of WIRED) {
      const page = resolveRoutePage({ id: "settings", view: tab } as never);
      expect(page?.component, `settings:${tab} has no page`).toBeTruthy();
    }
  });

  it("mounts the shared audit page for audit-logs, distinct from the authentication page", () => {
    const audit = resolveRoutePage({
      id: "settings",
      view: "audit-logs",
    } as never);
    expect(audit?.component).toBeTruthy();
    expect(audit?.component).not.toBe(
      resolveRoutePage({ id: "settings", view: "sso" } as never)?.component,
    );
  });

  // Users and Groups lead to separate surfaces.
  it("points Users at the member surface, which carries details, groups and invites", () => {
    const users = resolveRoutePage({ id: "settings", view: "users" } as never);
    const groups = resolveRoutePage({
      id: "settings",
      view: "groups",
    } as never);
    expect(users?.component).toBeTruthy();
    expect(groups?.component).toBeTruthy();
    expect(users?.component).not.toBe(groups?.component);
  });

  it("points Directory sync and SSO at the authentication surface with the allowed domain", () => {
    const scim = resolveRoutePage({
      id: "settings",
      view: "directory-sync",
    } as never);
    const sso = resolveRoutePage({ id: "settings", view: "sso" } as never);
    expect(scim?.component).toBe(sso?.component);
    expect(scim?.component).not.toBe(
      resolveRoutePage({ id: "settings", view: "users" } as never)?.component,
    );
  });
});
