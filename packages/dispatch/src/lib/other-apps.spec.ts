import { describe, expect, it } from "vitest";

import { filterBuiltInApps, filterOtherApps } from "./other-apps.js";

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
