// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const orgRole = vi.hoisted(() => ({
  current: {
    org: { orgId: "org-1" } as { orgId: string | null } | null,
    canManageOrg: true,
    isLoading: false,
  },
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => orgRole.current,
}));

import { AppListActions, AppTierSections } from "./app-tier-sections";
import { TooltipProvider } from "./ui/tooltip";

describe("AppTierSections", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    orgRole.current = {
      org: { orgId: "org-1" },
      canManageOrg: true,
      isLoading: false,
    };
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["nothing is pinned", [], false, "Apps"],
    ["an app is pinned", ["mail"], true, "dispatch.pages.pinnedApps"],
    // A search that matches no pinned app keeps the input where it was.
    ["no pinned app matches the search", [], true, "dispatch.pages.pinnedApps"],
  ])(
    "puts View all, search and New app together in the first header when %s",
    async (_case, pinned, hasPinnedApps, header) => {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <AppTierSections
              tiers={{ pinned, apps: ["plan"], hosted: [] }}
              hasPinnedApps={hasPinnedApps}
              appsTitle="Apps"
              actions={
                <AppListActions
                  viewAllHref="/apps"
                  search={<input data-search />}
                  newApp={<button type="button" data-new-app />}
                />
              }
              renderItems={(items) => items.join(",")}
            />
          </MemoryRouter>,
        ),
      );

      const search = container.querySelectorAll("[data-search]");
      expect(search).toHaveLength(1);
      const section = search[0]!.closest("section");
      expect(section?.getAttribute("aria-label")).toBe(header);
      const cluster = search[0]!.closest("[data-app-list-actions]")!;
      expect(
        [...cluster.children].map((child) =>
          child.matches("a")
            ? `link:${child.getAttribute("href")}:${child.textContent}`
            : child.querySelector("[data-search]")
              ? "search"
              : "new",
        ),
      ).toEqual(["link:/apps:dispatch.pages.viewAllApps", "search", "new"]);
      expect(container.querySelectorAll("[data-new-app]")).toHaveLength(1);
    },
  );

  it("lets a wide header action shrink into the row instead of overflowing", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <AppTierSections
            tiers={{ pinned: [], apps: [], hosted: [] }}
            appsTitle="Apps"
            actions={<AppListActions newApp={<div data-apps-action />} />}
            renderItems={() => null}
          />
        </MemoryRouter>,
      ),
    );

    const action =
      container.querySelector("[data-apps-action]")!.parentElement!;
    const classes = action.className.split(" ");
    expect(classes).not.toContain("shrink-0");
    expect(classes).toEqual(expect.arrayContaining(["min-w-0", "flex-1"]));
  });

  it.each([
    ["an admin", { orgId: "org-1" }, true, "link"],
    ["a member", { orgId: "org-1" }, false, "disabled"],
    ["a solo workspace", null, true, "none"],
    ["a user with no organization", { orgId: null }, true, "none"],
  ] as const)(
    "shows Manage on the Hosted apps tier as expected for %s",
    async (_who, org, canManageOrg, expected) => {
      orgRole.current = { org, canManageOrg, isLoading: false };
      await act(async () =>
        root.render(
          <MemoryRouter>
            <TooltipProvider>
              <AppTierSections
                tiers={{ pinned: [], apps: [], hosted: ["clips"] }}
                appsTitle="Apps"
                renderItems={(items) => items.join(",")}
              />
            </TooltipProvider>
          </MemoryRouter>,
        ),
      );

      const hosted = container.querySelector(
        'section[aria-label="dispatch.pages.hostedApps"]',
      )!;
      const manage = [...hosted.querySelectorAll("a, button")].find(
        (element) => element.textContent === "dispatch.pages.manageHostedApps",
      );
      const shown =
        manage === undefined
          ? "none"
          : manage.tagName === "A"
            ? "link"
            : (manage as HTMLButtonElement).disabled
              ? "disabled"
              : "enabled";
      expect(shown).toBe(expected);
    },
  );
});
