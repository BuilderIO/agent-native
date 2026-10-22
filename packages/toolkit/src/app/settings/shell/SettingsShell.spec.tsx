// @vitest-environment happy-dom

import React, { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useSearchParams,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgState = vi.hoisted(() => ({
  value: {
    data: { orgId: "org-1", role: "member" as string | null },
    isLoading: false,
    errorUpdatedAt: 0,
  },
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => orgState.value,
}));
vi.mock("@agent-native/core/client/labs/use-lab", () => ({
  useLabs: () => ({}),
  useLabStates: () => ({}),
}));
vi.mock("@agent-native/core/client/feature-flags/use-feature-flag", () => ({
  useFeatureFlags: () => ({}),
}));
vi.mock("../../chat/AgentSidebar.js", () => ({
  AgentToggleButton: () => (
    <button type="button" data-testid="shared-agent-toggle">
      agent
    </button>
  ),
}));

const appState = vi.hoisted(() => ({
  write: vi.fn(async (_key: string, value: unknown) => value),
  remove: vi.fn(async () => undefined),
}));
vi.mock(
  "@agent-native/core/client/application-state",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    writeClientAppState: appState.write,
    deleteClientAppState: appState.remove,
  }),
);

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";

import { createToolkitI18nCatalog } from "../../i18n.js";
import { useSettingsPageHeader, useSettingsShell } from "./context.js";
import { CORE_SETTINGS_PAGES } from "./core-pages.js";
import {
  _resetSettingsPagesForTests,
  getSettingsPages,
  mergeAppSettingsPages,
  registerSettingsPages,
  type AppSettingsPageDefinition,
  type SettingsPageProps,
} from "./registry.js";
import {
  _resetSettingsReturnPathForTests,
  rememberSettingsReturnPath,
} from "./return-path.js";
import { SettingsShell, type SettingsShellProps } from "./SettingsShell.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

function renderWithToolkitI18n(children: React.ReactNode) {
  return (
    <AgentNativeI18nProvider
      catalog={toolkitI18nCatalog}
      persistPreference={false}
    >
      {children}
    </AgentNativeI18nProvider>
  );
}

function StubPage({ pageId, sub }: SettingsPageProps) {
  return (
    <div data-testid="page">
      page:{pageId}
      {sub ? ` sub:${sub}` : ""}
    </div>
  );
}

function AppSettingsPage({ pageId, sub }: SettingsPageProps) {
  const { navigate } = useSettingsShell();
  return (
    <div data-testid="app-settings-page">
      page:{pageId}
      {sub ? ` sub:${sub}` : ""}
      <label>
        App control
        <input aria-label="App control" type="checkbox" />
      </label>
      <button
        type="button"
        onClick={() => navigate(pageId, "delivery")}
        data-testid="open-app-subpage"
      >
        Delivery
      </button>
    </div>
  );
}

function appPage(
  id: string,
  label: string,
  order = 25,
  component: AppSettingsPageDefinition["component"] = StubPage,
): AppSettingsPageDefinition {
  return {
    id,
    label,
    order,
    icon: CORE_SETTINGS_PAGES[0]!.icon,
    component,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Lazy page chunks resolve on their own schedule under vitest. */
async function waitFor(check: () => boolean, attempts = 50) {
  for (let attempt = 0; attempt < attempts && !check(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  expect(check()).toBe(true);
}

describe("SettingsShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    appState.write.mockClear();
    appState.remove.mockClear();
    orgState.value = {
      data: { orgId: "org-1", role: "member" },
      isLoading: false,
      errorUpdatedAt: 0,
    };
    // Stub every core page's component so the test exercises the real
    // definitions (ids, groups, order, visibility) without loading panels.
    registerSettingsPages(
      CORE_SETTINGS_PAGES.map((page) => ({ ...page, component: StubPage })),
    );
    window.history.replaceState(null, "", "/settings");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    _resetSettingsPagesForTests();
    _resetSettingsReturnPathForTests();
    vi.unstubAllGlobals();
  });

  async function render(props: SettingsShellProps = {}) {
    await act(async () => {
      root.render(
        renderWithToolkitI18n(<SettingsShell appName="Clips" {...props} />),
      );
    });
    await flush();
  }

  function rail() {
    return container.querySelector("aside")!;
  }

  function groupLabels() {
    return [
      ...rail().querySelectorAll<HTMLElement>("[data-settings-group]"),
    ].map((group) => ({
      id: group.dataset.settingsGroup,
      label: group.firstElementChild?.textContent,
      pages: [
        ...group.querySelectorAll<HTMLElement>("[data-settings-page]"),
      ].map((item) => item.dataset.settingsPage),
    }));
  }

  function clickPage(id: string) {
    const link = rail().querySelector<HTMLElement>(
      `[data-settings-page="${id}"]`,
    );
    if (!link) throw new Error(`No nav item for ${id}`);
    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }

  it("renders the five groups in spec order with Labs in the app group", async () => {
    await render();
    expect(groupLabels()).toEqual([
      {
        id: "account",
        label: "Account",
        pages: ["profile", "preferences", "security"],
      },
      {
        id: "app",
        label: "Clips",
        pages: ["app", "automations", "channels", "mcp", "labs"],
      },
      {
        id: "connections",
        label: "Connections",
        pages: ["integrations", "api-keys"],
      },
      {
        id: "agent",
        label: "Agent",
        pages: [
          "model",
          "instructions",
          "personalization",
          "memory",
          "skills",
          "files",
          "sub-agents",
        ],
      },
      {
        id: "organization",
        label: "Organization",
        pages: ["org", "members", "usage"],
      },
    ]);
    expect(container.textContent).toContain("Back to Clips");
  });

  it("adds ordered app-owned pages and renders their custom controls", async () => {
    await render({
      notifications: <p>Email notifications</p>,
      appSettingsPages: [
        appPage(
          "custom-preferences",
          "Custom preferences",
          25,
          AppSettingsPage,
        ),
        appPage("custom-options", "Custom options", 27),
      ],
    });

    expect(groupLabels().find((group) => group.id === "app")?.pages).toEqual([
      "app",
      "notifications",
      "custom-preferences",
      "custom-options",
      "automations",
      "channels",
      "mcp",
      "labs",
    ]);
    clickPage("custom-preferences");
    await waitFor(() =>
      Boolean(container.querySelector('[data-testid="app-settings-page"]')),
    );
    expect(
      container.querySelector('[data-testid="app-settings-page"]')?.textContent,
    ).toContain("page:custom-preferences");
    expect(
      container.querySelector('[aria-label="App control"]'),
    ).not.toBeNull();
    expect(
      getSettingsPages().some((page) => page.id === "mail-preferences"),
    ).toBe(false);
  });

  it("renders ordered app sections with page, link, and action entries", async () => {
    const onAddWorkspace = vi.fn();
    const customPage = {
      ...appPage("workspace-alpha", "Workspace Alpha", 25, AppSettingsPage),
      subpages: [{ id: "settings", label: "Workspace settings" }],
    };

    await render({
      appSettingsPages: [customPage],
      appNavigationSections: [
        {
          id: "workspaces",
          label: "Workspaces",
          items: [
            {
              id: "workspace-settings",
              type: "page",
              pageId: "workspace-alpha",
              sub: "settings",
              label: "Workspace settings",
            },
            {
              id: "workspace-help",
              type: "link",
              label: "Workspace help",
              href: "/help",
              visibleWhen: () => false,
            },
            {
              id: "add-workspace",
              type: "action",
              label: "Add workspace",
              onSelect: onAddWorkspace,
            },
          ],
        },
        {
          id: "administration",
          label: "Administration",
          visibleWhen: (context) => context.isAdmin,
          items: [
            {
              id: "invite-member",
              type: "action",
              label: "Invite member",
              onSelect: () => undefined,
            },
          ],
        },
      ],
    });

    expect(
      [...rail().querySelectorAll<HTMLElement>("[data-settings-group]")].map(
        (group) => group.dataset.settingsGroup,
      ),
    ).toEqual(["workspaces"]);
    expect(
      rail().querySelector('[data-settings-link="workspace-help"]'),
    ).toBeNull();
    expect(
      rail()
        .querySelector('[data-settings-page="workspace-alpha"]')
        ?.getAttribute("href"),
    ).toBe("/settings/workspace-alpha/settings");

    act(() => {
      rail()
        .querySelector<HTMLButtonElement>(
          '[data-settings-action="add-workspace"]',
        )
        ?.click();
    });
    expect(onAddWorkspace).toHaveBeenCalled();

    clickPage("workspace-alpha");
    await waitFor(() =>
      Boolean(container.querySelector('[data-testid="app-settings-page"]')),
    );
  });

  it("keeps controlled template tabs ahead of a same-id app page", async () => {
    const extraTab = {
      id: "workspace-alpha",
      label: "Template workspace",
      content: "Template workspace content",
    };
    const customPage = appPage(
      "workspace-alpha",
      "Workspace alpha",
      5,
      AppSettingsPage,
    );

    await render({
      value: "profile",
      initialValue: "profile",
      extraTabs: [extraTab],
      appSettingsPages: [customPage],
    });
    await act(async () => {
      root.render(
        renderWithToolkitI18n(
          <SettingsShell
            appName="Clips"
            value="workspace-alpha"
            initialValue="profile"
            extraTabs={[extraTab]}
            appSettingsPages={[customPage]}
          />,
        ),
      );
    });
    await waitFor(() =>
      window.location.pathname.endsWith("/app-workspace-alpha"),
    );
  });

  it("mounts an app chat panel and replaces the shared toggle by default", async () => {
    await render({
      agentPanel: <div data-testid="app-agent-panel">Local chat</div>,
      agentToggle: (
        <button type="button" data-testid="app-agent-toggle">
          Open chat
        </button>
      ),
    });

    const shell = container.querySelector<HTMLElement>("[data-settings-shell]");
    const panel = shell?.querySelector('[data-testid="app-agent-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(shell);
    expect(
      shell?.querySelector('[data-testid="app-agent-toggle"]'),
    ).not.toBeNull();
    expect(
      shell?.querySelector('[data-testid="shared-agent-toggle"]'),
    ).toBeNull();
  });

  it("keeps template tabs separate when an app page uses the same id", async () => {
    await render({
      appSettingsPages: [
        appPage("custom-controls", "Custom controls", 25, AppSettingsPage),
      ],
      extraTabs: [
        { id: "custom-controls", label: "Template controls", content: "tabs" },
      ],
    });

    expect(groupLabels().find((group) => group.id === "app")?.pages).toEqual(
      expect.arrayContaining(["custom-controls", "app-custom-controls"]),
    );
    clickPage("custom-controls");
    await waitFor(() =>
      Boolean(container.querySelector('[data-testid="app-settings-page"]')),
    );
  });

  it("rejects app page ids that would replace an existing page", () => {
    expect(() =>
      mergeAppSettingsPages(CORE_SETTINGS_PAGES, [
        appPage("profile", "Replacement profile"),
      ]),
    ).toThrow(
      'App settings page id "profile" conflicts with an existing page id.',
    );
    expect(() =>
      mergeAppSettingsPages(
        [],
        [
          appPage("custom-preferences", "First"),
          appPage("custom-preferences", "Second"),
        ],
      ),
    ).toThrow('Duplicate app settings page id "custom-preferences".');
  });

  it("keeps app pages and search entries isolated between shell instances", async () => {
    const firstRouter = createMemoryRouter(
      [
        {
          path: "/settings/*",
          element: (
            <SettingsShell
              appName="First app"
              appSettingsPages={[
                {
                  ...appPage("first-settings", "First settings", 25),
                  keywords: "first-only",
                },
              ]}
            />
          ),
        },
      ],
      { initialEntries: ["/settings/first-settings"] },
    );
    const secondRouter = createMemoryRouter(
      [
        {
          path: "/settings/*",
          element: (
            <SettingsShell
              appName="Second app"
              appSettingsPages={[
                {
                  ...appPage("second-settings", "Second settings", 25),
                  keywords: "second-only",
                },
              ]}
            />
          ),
        },
      ],
      { initialEntries: ["/settings/second-settings"] },
    );

    await act(async () => {
      root.render(
        renderWithToolkitI18n(
          <>
            <RouterProvider router={firstRouter} />
            <RouterProvider router={secondRouter} />
          </>,
        ),
      );
    });
    await flush();

    const shells = [
      ...container.querySelectorAll<HTMLElement>("[data-settings-shell]"),
    ];
    expect(shells).toHaveLength(2);
    expect(shells[0]?.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:first-settings",
    );
    expect(shells[1]?.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:second-settings",
    );
    expect(
      shells[0]?.querySelector('[data-settings-page="second-settings"]'),
    ).toBeNull();
    expect(
      shells[1]?.querySelector('[data-settings-page="first-settings"]'),
    ).toBeNull();

    const inputs = shells.map(
      (shell) => shell.querySelector<HTMLInputElement>('input[type="search"]')!,
    );
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(inputs[0], "first-only");
      inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(inputs[1], "first-only");
      inputs[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(shells[0]?.querySelector('[role="option"]')?.textContent).toContain(
      "First settings",
    );
    expect(shells[1]?.querySelector('[role="option"]')).toBeNull();
    expect(getSettingsPages().map((page) => page.id)).not.toEqual(
      expect.arrayContaining(["first-settings", "second-settings"]),
    );
  });

  it("shows Notifications and What's new when the app passes them", async () => {
    await render({
      notifications: <div>email</div>,
      whatsNewMarkdown: "## 2026-09-25\n- Added",
    });
    expect(groupLabels().find((group) => group.id === "app")?.pages).toEqual([
      "app",
      "notifications",
      "automations",
      "channels",
      "mcp",
      "labs",
      "whats-new",
    ]);
    expect(rail().querySelector('[data-settings-group="footer"]')).toBeNull();
  });

  it("shows owners and admins the four extra Organization pages", async () => {
    orgState.value = {
      data: { orgId: "org-1", role: "admin" },
      isLoading: false,
      errorUpdatedAt: 0,
    };
    await render();
    expect(
      groupLabels().find((group) => group.id === "organization")?.pages,
    ).toEqual(["org", "members", "usage", "auth", "apps", "infra", "audit"]);
  });

  it("opens Profile by default and navigates between pages", async () => {
    await render();
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:profile",
    );
    clickPage("api-keys");
    await flush();
    expect(window.location.pathname).toBe("/settings/api-keys");
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:api-keys",
    );
    expect(
      rail()
        .querySelector('[aria-current="page"]')
        ?.getAttribute("data-settings-page"),
    ).toBe("api-keys");
  });

  it("sends a member who opens an admin page to Profile", async () => {
    window.history.replaceState(null, "", "/settings/infra");
    await render();
    await flush();
    expect(window.location.pathname).toBe("/settings/profile");
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:profile",
    );
  });

  it("keeps today's tab links working", async () => {
    window.history.replaceState(null, "", "/settings/agent/resources/memory");
    await render();
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:memory",
    );
    expect(window.location.pathname).toBe("/settings/memory");
  });

  it("rewrites a legacy link to the page's path, keeping the query and row", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/connections?connected=slack",
    );
    await render();
    await flush();
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/settings/integrations?connected=slack",
    );

    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, "", "/settings/general#ai-providers");
    await render();
    await flush();
    expect(`${window.location.pathname}${window.location.hash}`).toBe(
      "/settings/app#ai-providers",
    );
  });

  it("opens the page an agent-panel section names, not the hash it navigated to", async () => {
    let location = "";
    function Probe() {
      const current = useLocation();
      location = `${current.pathname}${current.hash}`;
      return <SettingsShell appName="Clips" />;
    }
    const router = createMemoryRouter(
      [{ path: "/settings/*", element: <Probe /> }],
      {
        initialEntries: [
          {
            pathname: "/settings",
            hash: "#integrations",
            state: { agentNativeSettingsSection: "secrets" },
          },
        ],
      },
    );
    await act(async () => {
      root.render(renderWithToolkitI18n(<RouterProvider router={router} />));
    });
    await waitFor(() => location === "/settings/api-keys");
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe(
      "page:api-keys",
    );
  });

  it.each([
    ["drafting", "/settings/drafting", "page:drafting"],
    // Mail's /team route sends ?section=team, which has no tab today.
    ["team", "/settings/members", "page:members"],
  ])(
    "follows Mail's ?section=%s deep link after Mail strips the param",
    async (section, path, page) => {
      let location = "";
      function MailLikeSettings() {
        const [searchParams, setSearchParams] = useSearchParams();
        const [active, setActive] = useState("integrations");
        const current = useLocation();
        location = `${current.pathname}${current.search}`;
        React.useEffect(() => {
          const next = searchParams.get("section");
          if (!next) return;
          setActive(next);
          setSearchParams(
            (prev) => {
              const params = new URLSearchParams(prev);
              params.delete("section");
              return params;
            },
            { replace: true },
          );
        }, [searchParams, setSearchParams]);
        return (
          <SettingsShell
            appName="Mail"
            team={<p>team</p>}
            extraTabs={[
              {
                id: "drafting",
                label: "Drafting",
                content: <p data-testid="page">page:drafting</p>,
              },
            ]}
            value={active}
            onValueChange={setActive}
          />
        );
      }
      const router = createMemoryRouter(
        [{ path: "/settings/*", element: <MailLikeSettings /> }],
        { initialEntries: [`/settings?section=${section}`] },
      );
      await act(async () => {
        root.render(renderWithToolkitI18n(<RouterProvider router={router} />));
      });
      await waitFor(
        () =>
          location === path &&
          container.querySelector('[data-testid="page"]')?.textContent === page,
      );
    },
  );

  it("records the open page for the agent and clears it on leaving", async () => {
    window.history.replaceState(null, "", "/settings/integrations/builder");
    await render();
    expect(appState.write).toHaveBeenLastCalledWith(
      "settings-view",
      {
        page: "integrations",
        sub: "builder",
        label: "Connections › Integrations › Builder.io",
      },
      expect.objectContaining({ requestSource: expect.any(String) }),
    );
    clickPage("model");
    await flush();
    expect(appState.write).toHaveBeenLastCalledWith(
      "settings-view",
      { page: "model", sub: null, label: "Agent › Model" },
      expect.anything(),
    );
    act(() => root.unmount());
    root = createRoot(container);
    expect(appState.remove).toHaveBeenCalledWith(
      "settings-view",
      expect.objectContaining({ keepalive: true }),
    );
  });

  describe("search", () => {
    function searchInput() {
      return rail().querySelector<HTMLInputElement>('input[type="search"]')!;
    }
    function search(query: string) {
      const input = searchInput();
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      act(() => {
        setValue.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return [...rail().querySelectorAll('[role="option"]')].map(
        (option) => option.textContent ?? "",
      );
    }
    function press(key: string) {
      act(() => {
        searchInput().dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    }

    it("finds rows from today's sections under their new pages", async () => {
      await render();
      expect(search("default model")[0]).toBe("Default modelAgent › Model");
      expect(search("max iterations")[0]).toBe("Max iterationsAgent › Model");
      // The agent in Slack is a channel; Slack's search tools stay an
      // integration.
      expect(search("slack")).toEqual(
        expect.arrayContaining([
          "SlackClips › Channels",
          "SlackConnections › Integrations",
        ]),
      );
      expect(search("voice")[0]).toBe(
        "Voice transcriptionAccount › Preferences",
      );
    });

    it("keeps owner and admin pages out of a member's results", async () => {
      await render();
      expect(search("scim")).toEqual([]);
      // Database integrations (Neon, Supabase) still match.
      expect(
        search("database").filter((hit) => hit.includes("Infrastructure")),
      ).toEqual([]);

      act(() => root.unmount());
      root = createRoot(container);
      orgState.value = {
        data: { orgId: "org-1", role: "admin" },
        isLoading: false,
        errorUpdatedAt: 0,
      };
      await render();
      expect(search("scim")[0]).toBe("AuthenticationOrganization");
      expect(search("database")[0]).toBe(
        "DatabaseOrganization › Infrastructure",
      );
      expect(search("web search")[0]).toBe(
        "Web searchOrganization › Infrastructure",
      );
    });

    it("opens the first hit on Enter and flashes its row", async () => {
      function ModelPage() {
        return (
          <div id="max-iterations" data-testid="page">
            limits
          </div>
        );
      }
      const model = CORE_SETTINGS_PAGES.find((page) => page.id === "model")!;
      registerSettingsPages([{ ...model, component: ModelPage }]);
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      await render();
      search("max iterations");
      press("Enter");
      await waitFor(() =>
        Boolean(
          container
            .querySelector("#max-iterations")
            ?.hasAttribute("data-settings-flash"),
        ),
      );
      expect(`${window.location.pathname}${window.location.hash}`).toBe(
        "/settings/model#max-iterations",
      );
      expect(scrollIntoView).toHaveBeenCalled();
      expect(searchInput().value).toBe("");
    });

    it("finds app areas and labs, and opens an area's row on its tab", async () => {
      await render({
        appAreas: [
          {
            id: "recordings",
            label: "Recordings",
            content: null,
            searchEntries: [
              { id: "speed", label: "Playback speed", hash: "playback" },
            ],
          },
        ],
        labs: [{ key: "clips.meetings", displayName: "Meetings lab" }],
      });
      expect(search("recordings")[0]).toBe("RecordingsClips › General");
      expect(search("meetings lab")[0]).toBe("Meetings labClips › Labs");
      search("playback speed");
      press("Enter");
      await flush();
      expect(`${window.location.pathname}${window.location.hash}`).toBe(
        "/settings/app/recordings#playback",
      );
    });

    it("routes an app page search entry to its nested page", async () => {
      const customPage: AppSettingsPageDefinition = {
        ...appPage("custom-controls", "Custom controls", 25, AppSettingsPage),
        subpages: [{ id: "delivery", label: "Delivery settings" }],
        searchEntries: [
          {
            id: "delivery-rules",
            label: "Delivery rules",
            keywords: "exceptions",
            sub: "delivery",
          },
        ],
      };
      await render({ appSettingsPages: [customPage] });

      clickPage("custom-controls");
      await waitFor(() =>
        Boolean(container.querySelector('[data-testid="app-settings-page"]')),
      );
      expect(
        container.querySelector('[aria-label="App control"]'),
      ).not.toBeNull();

      expect(search("delivery exceptions")[0]).toContain("Delivery rules");
      press("Enter");
      await flush();
      expect(window.location.pathname).toBe(
        "/settings/custom-controls/delivery",
      );
      expect(
        container.querySelector('[aria-current="page"]')?.textContent,
      ).toBe("Delivery settings");
      expect(
        container.querySelector('[data-testid="app-settings-page"]')
          ?.textContent,
      ).toContain("sub:delivery");
    });

    it("focuses on / and clears on Escape", async () => {
      await render();
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "/", bubbles: true }),
        );
      });
      expect(document.activeElement).toBe(searchInput());
      search("usage");
      press("Escape");
      expect(searchInput().value).toBe("");
      expect(rail().querySelector('[role="option"]')).toBeNull();
    });
  });

  it("turns a template's own tabs into pages in the app group", async () => {
    await render({
      extraTabs: [
        { id: "notifications", label: "Notifications", content: "n" },
        { id: "drafting", label: "Drafting", content: <p>Drafting body</p> },
      ],
    });
    expect(groupLabels().find((group) => group.id === "app")?.pages).toEqual([
      "app",
      "drafting",
      "notifications",
      "automations",
      "channels",
      "mcp",
      "labs",
    ]);
    clickPage("drafting");
    await waitFor(() =>
      Boolean(container.textContent?.includes("Drafting body")),
    );
  });

  it("keeps Observability under Agent and opens its page", async () => {
    await render({
      extraTabs: [
        {
          id: "observability",
          label: "Agent Observability",
          group: "agent",
          content: <p>Human review body</p>,
        },
      ],
    });

    expect(
      groupLabels()
        .find((group) => group.id === "agent")
        ?.pages.at(-1),
    ).toBe("observability");
    clickPage("observability");
    await waitFor(() =>
      Boolean(container.textContent?.includes("Human review body")),
    );
  });

  it("bridges a controlled tab value both ways", async () => {
    const onValueChange = vi.fn();
    const tabs = [
      { id: "agent", label: "Overview", content: "overview" },
      { id: "drafting", label: "Drafting", content: "drafting" },
    ];
    await render({ extraTabs: tabs, value: "integrations", onValueChange });
    // The template's initial default doesn't move the viewer off Profile.
    expect(window.location.pathname).toBe("/settings");

    clickPage("model");
    await flush();
    expect(onValueChange).toHaveBeenLastCalledWith("agent");

    // Pages the template has no tab for report nothing, so a template that
    // maps unknown ids to "general" can't bounce the viewer.
    onValueChange.mockClear();
    clickPage("security");
    await flush();
    clickPage("labs");
    await flush();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/settings/labs");

    await act(async () => {
      root.render(
        renderWithToolkitI18n(
          <SettingsShell
            appName="Clips"
            extraTabs={tabs}
            value="drafting"
            onValueChange={onValueChange}
          />,
        ),
      );
    });
    await flush();
    expect(window.location.pathname).toBe("/settings/drafting");
  });

  it("follows a value the template changed while the gate was loading", async () => {
    await render({
      extraTabs: [{ id: "drafting", label: "Drafting", content: "drafting" }],
      initialValue: "integrations",
      value: "drafting",
    });
    await flush();
    expect(window.location.pathname).toBe("/settings/drafting");
  });

  it("returns to the last app route", async () => {
    rememberSettingsReturnPath("/library", "?view=grid");
    await render();
    const back = [...rail().querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Back to Clips"),
    );
    expect(back?.getAttribute("href")).toBe("/library?view=grid");
  });

  it("searches pages by label and opens the first hit on Enter", async () => {
    await render();
    const input = rail().querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(input, "api keys");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const firstResult = rail().querySelector('[role="option"]');
    expect(firstResult?.textContent).toContain("API keys");
    expect(firstResult?.textContent).toContain("Connections");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush();
    expect(window.location.pathname).toBe("/settings/api-keys");
  });

  it("holds a skeleton while the viewer's role loads", async () => {
    orgState.value = {
      data: undefined as never,
      isLoading: true,
      errorUpdatedAt: 0,
    };
    await render();
    expect(
      container.querySelector('[role="status"][aria-busy="true"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-settings-page]")).toBeNull();
  });

  it("offers a menu button for the mobile drawer", async () => {
    await render();
    expect(
      container.querySelector('button[aria-label="Open settings menu"]'),
    ).not.toBeNull();
  });

  it("navigates through a data router so a template's own URL writes see the new page", async () => {
    let location = "";
    // Brain's pattern: the controlled tab id is mirrored into ?section= with
    // setSearchParams, which resolves against the router's current location.
    function BrainLikeSettings() {
      const [searchParams, setSearchParams] = useSearchParams();
      const [section, setSection] = useState("integrations");
      const current = useLocation();
      location = `${current.pathname}${current.search}`;
      return (
        <SettingsShell
          appName="Brain"
          extraTabs={[{ id: "agent", label: "Overview", content: "overview" }]}
          value={searchParams.get("section") ?? section}
          onValueChange={(next) => {
            setSection(next);
            setSearchParams({ section: next }, { replace: true });
          }}
        />
      );
    }
    const router = createMemoryRouter(
      [{ path: "/settings/*", element: <BrainLikeSettings /> }],
      { initialEntries: ["/settings"] },
    );
    await act(async () => {
      root.render(renderWithToolkitI18n(<RouterProvider router={router} />));
    });
    await flush();
    clickPage("model");
    await waitFor(() => location === "/settings/model?section=agent");
    clickPage("api-keys");
    await waitFor(() => location.startsWith("/settings/api-keys"));
  });

  it("redirects and navigates through a slow data router while the page re-renders", async () => {
    let location = "";
    function BusySettings() {
      // A template that re-renders on its own (loading state, polling) while
      // the router is still committing the previous navigation.
      const [, setTick] = useState(0);
      React.useEffect(() => {
        // Re-render during the 60ms loader without keeping act() busy forever.
        let ticks = 0;
        const timer = setInterval(() => {
          setTick((tick) => tick + 1);
          if (++ticks === 5) clearInterval(timer);
        }, 10);
        return () => clearInterval(timer);
      }, []);
      const current = useLocation();
      location = current.pathname;
      return <SettingsShell appName="Clips" general={<p>General</p>} />;
    }
    const router = createMemoryRouter(
      [
        {
          path: "/settings/*",
          element: <BusySettings />,
          loader: () => new Promise((resolve) => setTimeout(resolve, 60)),
        },
      ],
      { initialEntries: ["/settings/infra"] },
    );
    await act(async () => {
      root.render(renderWithToolkitI18n(<RouterProvider router={router} />));
    });
    await waitFor(() => location === "/settings/profile", 400);
    clickPage("org");
    await waitFor(() => location === "/settings/org", 400);
  }, 30_000);

  it("keeps the admin pages from a member whose organization couldn't be read", async () => {
    orgState.value = {
      data: undefined as never,
      isLoading: false,
      errorUpdatedAt: 1,
    };
    window.history.replaceState(null, "", "/settings/infra");
    await render();
    await flush();
    expect(
      groupLabels().find((group) => group.id === "organization")?.pages,
    ).toEqual(["org", "members", "usage"]);
    expect(window.location.pathname).toBe("/settings/profile");
  });

  it("stays on the pages while a failed organization read retries", async () => {
    orgState.value = {
      data: undefined as never,
      isLoading: true,
      errorUpdatedAt: 1,
    };
    await render();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(
      groupLabels().find((group) => group.id === "organization")?.pages,
    ).toEqual(["org", "members", "usage"]);
  });

  it("keeps a page's own header across page and sub-page changes", async () => {
    function HeaderPage({ sub }: SettingsPageProps) {
      const { navigate } = useSettingsShell();
      const header = useMemo(
        () => ({
          title: sub === "builder" ? "Builder.io" : undefined,
          action: <button type="button">Connect</button>,
        }),
        [sub],
      );
      useSettingsPageHeader(header);
      return (
        <button
          type="button"
          data-testid="open-sub"
          onClick={() => navigate("integrations", "builder")}
        >
          open
        </button>
      );
    }
    const integrations = CORE_SETTINGS_PAGES.find(
      (page) => page.id === "integrations",
    )!;
    registerSettingsPages([{ ...integrations, component: HeaderPage }]);
    await render();
    const header = () => container.querySelector("header")!;

    clickPage("integrations");
    await flush();
    expect(header().textContent).toContain("Connect");

    act(() => {
      container
        .querySelector<HTMLElement>('[data-testid="open-sub"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(window.location.pathname).toBe("/settings/integrations/builder");
    expect(header().querySelector('[aria-current="page"]')?.textContent).toBe(
      "Builder.io",
    );
    expect(header().textContent).toContain("Connect");

    clickPage("profile");
    await flush();
    expect(header().textContent).not.toContain("Connect");
    clickPage("integrations");
    await flush();
    expect(header().textContent).toContain("Connect");
  });

  it("opens a Resources search entry on the page that now holds it", async () => {
    await render({
      extraTabs: [
        {
          id: "agent:resources",
          label: "Resources",
          content: "resources",
          searchEntries: [
            {
              id: "agent-resource-learnings",
              label: "Learnings",
              hash: "agent:resources:learnings",
            },
            {
              id: "agent-resource-remote-agents",
              label: "Remote agents",
              hash: "agent:resources:remote-agents",
            },
          ],
        },
      ],
    });
    const input = rail().querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const search = (query: string) => {
      act(() => {
        setValue.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return [...rail().querySelectorAll('[role="option"]')].map(
        (option) => option.textContent,
      );
    };

    const learnings = search("learnings");
    expect(learnings[0]).toContain("Learnings");
    expect(learnings[0]).toContain("Agent › Memory");
    expect(
      learnings.filter((text) => text?.includes("Learnings")),
    ).toHaveLength(1);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush();
    expect(window.location.pathname).toBe("/settings/memory");
    expect(window.location.hash).toBe("#learnings");

    const remote = search("remote agents");
    expect(remote.some((text) => text?.includes("Agent › Sub-agents"))).toBe(
      true,
    );
    expect(remote.some((text) => text?.includes("Files"))).toBe(false);
  });
});
