import { describe, expect, it, vi } from "vitest";

import {
  chatFirstExternalApps,
  filterBuiltInApps,
  filterOtherApps,
} from "./other-apps.js";

describe("filterBuiltInApps", () => {
  it("keeps configured first-party apps not mounted in the workspace", () => {
    expect(
      filterBuiltInApps(
        [
          {
            id: "slides",
            name: "Slides",
            url: "https://slides.agent-native.com",
            source: "builtin",
          },
          {
            id: "clips",
            name: "Clips",
            url: "https://clips.agent-native.com",
            source: "builtin",
          },
          {
            id: "custom-agent",
            name: "Custom agent",
            url: "https://agent.example.test",
            source: "custom",
          },
          {
            id: "workspace-agent",
            name: "Workspace agent",
            url: "https://workspace.example.test",
            source: "workspace",
          },
          {
            id: "invalid",
            name: "Invalid",
            url: "/invalid",
            source: "builtin",
          },
        ],
        [{ id: "clips" }],
      ),
    ).toEqual([
      {
        id: "slides",
        name: "Slides",
        url: "https://slides.agent-native.com",
        source: "builtin",
      },
    ]);
  });

  it("leaves out hosted apps the organization hides unless asked to keep them", () => {
    const apps = [
      {
        id: "slides",
        name: "Slides",
        url: "https://slides.agent-native.com",
        source: "builtin" as const,
        hiddenFromLaunchers: true,
      },
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
        source: "builtin" as const,
      },
    ];

    expect(filterBuiltInApps(apps, []).map((app) => app.id)).toEqual(["clips"]);
    expect(
      filterBuiltInApps(apps, [], { includeHiddenFromLaunchers: true }).map(
        (app) => app.id,
      ),
    ).toEqual(["clips", "slides"]);
  });

  it("keeps built-in app launches on the current beta lane", () => {
    vi.stubGlobal("window", {
      location: { hostname: "beta.agent-workspace.builder.io" },
    });

    try {
      expect(
        filterBuiltInApps(
          [
            {
              id: "clips",
              name: "Clips",
              url: "https://clips.agent-native.com/",
              homeUrl: "https://clips.agent-native.com/recordings",
              source: "builtin",
            },
          ],
          [],
        ),
      ).toEqual([
        {
          id: "clips",
          name: "Clips",
          url: "https://beta.clips.agent-native.com/",
          homeUrl: "https://beta.clips.agent-native.com/recordings",
          source: "builtin",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("filterOtherApps", () => {
  it("keeps available linked apps while excluding workspace apps", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "slides",
            name: "Slides",
            url: "https://slides.agent-native.com",
            source: "custom",
          },
          {
            id: "analytics",
            name: "Analytics",
            description: "Explore data",
            url: "https://analytics.agent-native.com",
            source: "custom",
          },
          {
            id: "coach",
            name: "Coach",
            url: "https://workspace.example.com/coach",
            source: "workspace",
          },
          {
            id: "dispatch",
            name: "Dispatch",
            url: "https://dispatch.agent-native.com",
          },
        ],
        [{ id: "coach" }],
      ),
    ).toEqual([
      {
        id: "analytics",
        name: "Analytics",
        description: "Explore data",
        url: "https://analytics.agent-native.com",
        source: "custom",
      },
      {
        id: "slides",
        name: "Slides",
        url: "https://slides.agent-native.com",
        source: "custom",
      },
    ]);
  });

  it("drops invalid URLs and duplicate app ids", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "analytics",
            name: "Analytics",
            url: "https://analytics.agent-native.com",
            source: "custom",
          },
          {
            id: "Analytics",
            name: "Analytics duplicate",
            url: "https://duplicate.example.com",
            source: "custom",
          },
          {
            id: "relative",
            name: "Relative",
            url: "/relative",
            source: "custom",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "analytics",
        name: "Analytics",
        url: "https://analytics.agent-native.com",
        source: "custom",
      },
    ]);
  });

  it("hides the unsupported CRM and Research entries", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "crm",
            name: "CRM",
            url: "https://crm.example.com",
          },
          {
            id: "research",
            name: "Research",
            url: "https://research.example.com",
          },
          {
            id: "mail",
            name: "Mail",
            url: "https://mail.agent-native.com",
            source: "custom",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "mail",
        name: "Mail",
        url: "https://mail.agent-native.com",
        source: "custom",
      },
    ]);
  });

  it("hides the generic chat starter from connected app launchers", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "chat",
            name: "Chat",
            url: "https://chat.agent-native.com",
            source: "builtin",
          },
          {
            id: "mail",
            name: "Mail",
            url: "https://mail.agent-native.com",
            source: "custom",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "mail",
        name: "Mail",
        url: "https://mail.agent-native.com",
        source: "custom",
      },
    ]);
  });

  it("hides builtin, workspace, and unknown sources from external app launchers", () => {
    expect(
      filterOtherApps(
        [
          {
            id: "account-tiering",
            name: "Account Tiering",
            url: "https://account-tiering.agent-native.com",
            source: "builtin",
          },
          {
            id: "workspace-app",
            name: "Workspace app",
            url: "https://workspace.example.com/app",
            source: "workspace",
          },
          {
            id: "unknown-source",
            name: "Unknown source",
            url: "https://unknown.example.com",
          },
          {
            id: "connected-agent",
            name: "Connected agent",
            url: "https://agent.example.com",
            source: "custom",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "connected-agent",
        name: "Connected agent",
        url: "https://agent.example.com",
        source: "custom",
      },
    ]);
  });
});

describe("connected apps in the chat-first pane", () => {
  it("opens an app connected from another workspace at its own origin", async () => {
    const { resolveChatFirstAppTarget } =
      await import("@agent-native/core/client/agent-chat");
    const { mergeChatFirstWorkspaceApps } = await import("./workspace-apps.js");
    const mounted = [{ id: "mail-2", name: "Mail", path: "/mail-2" }];
    const apps = mergeChatFirstWorkspaceApps(
      mounted,
      [],
      chatFirstExternalApps(
        [
          {
            id: "fleet",
            name: "Fleet",
            url: "https://agent-workspace.example.com/fleet",
            source: "custom",
          },
        ],
        mounted,
      ),
    );
    const registrations = apps.map((app) => ({
      id: app.id,
      name: app.name,
      source: app.source,
      path: app.path,
      url: app.url,
      enabled: true,
    }));

    expect(
      resolveChatFirstAppTarget(
        {
          app: "fleet",
          url: "https://agent-workspace.example.com/fleet/home",
        },
        registrations,
        { currentOrigin: "https://labs.example.com" },
      ),
    ).toEqual({ status: "ready", target: { appId: "fleet", path: "/home" } });
    expect(
      resolveChatFirstAppTarget(
        { url: "https://agent-workspace.example.com/other/home" },
        registrations,
        { currentOrigin: "https://labs.example.com" },
      ),
    ).toEqual({ status: "unresolved", reason: "unknown-app" });
  });
});

describe("chatFirstExternalApps", () => {
  const connected = [
    {
      id: "slides",
      name: "Slides",
      url: "https://slides.example.com/deck",
      homeUrl: "https://slides.example.com/home",
      source: "builtin" as const,
      hiddenFromLaunchers: true,
    },
    {
      id: "fleet",
      name: "Fleet",
      description: "Fleet dashboard",
      url: "https://agent-workspace.example.com/fleet",
      source: "custom" as const,
    },
    {
      id: "mail-2",
      name: "Mail elsewhere",
      url: "https://elsewhere.example.com/mail-2",
      source: "custom" as const,
    },
  ];

  it("lists hosted apps at their home URL, keeps hidden ones, and tags connected apps", () => {
    expect(chatFirstExternalApps(connected, [{ id: "mail-2" }])).toEqual([
      {
        id: "slides",
        name: "Slides",
        url: "https://slides.example.com/home",
        source: "builtin",
        hiddenFromLaunchers: true,
      },
      {
        id: "fleet",
        name: "Fleet",
        description: "Fleet dashboard",
        url: "https://agent-workspace.example.com/fleet",
        source: "connected",
      },
    ]);
  });

  it("lists nothing while the mounted app list is loading", () => {
    expect(chatFirstExternalApps(connected, "loading")).toEqual([]);
  });

  it("keeps every hosted and connected app when the mounted list is unreadable", () => {
    expect(
      chatFirstExternalApps(connected, "unreadable").map((app) => app.id),
    ).toEqual(["slides", "fleet", "mail-2"]);
  });
});
