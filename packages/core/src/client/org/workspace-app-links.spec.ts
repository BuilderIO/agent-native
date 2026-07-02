import { describe, expect, it } from "vitest";

import {
  defaultOrgAppLinks,
  dispatchAppsHref,
  parseWorkspaceAppLinks,
  visibleOrgAppLinks,
} from "./workspace-app-links.js";

describe("org switcher app links", () => {
  it("lists the default app suite with Dispatch pinned", () => {
    const apps = defaultOrgAppLinks();

    expect(apps).toHaveLength(13);
    expect(apps[0]).toMatchObject({
      id: "dispatch",
      name: "Dispatch",
      icon: "MessageCircle",
      isDispatch: true,
      href: "https://dispatch.agent-native.com/overview",
    });
    expect(apps.find((app) => app.id === "brain")?.icon).toBe("Brain");
    expect(apps.find((app) => app.id === "analytics")?.icon).toBe("BarChart2");
    expect(apps.map((app) => app.id)).toEqual(
      expect.arrayContaining([
        "analytics",
        "assets",
        "brain",
        "calendar",
        "chat",
        "clips",
        "content",
        "design",
        "forms",
        "mail",
        "plan",
        "slides",
      ]),
    );
    expect(apps.map((app) => app.id)).not.toContain("starter");
    expect(apps.map((app) => app.id)).not.toContain("videos");
  });

  it("uses this origin under /<app>/ for a path-prefixed deployment", () => {
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      location: { origin: "https://apps.evinced.tech" },
    };
    try {
      // VITE_APP_BASE_PATH is baked by a path-prefixed deploy — links must stay
      // on this origin, not escape to *.agent-native.com.
      const apps = defaultOrgAppLinks({ VITE_APP_BASE_PATH: "/mail" });
      expect(apps.find((a) => a.id === "mail")?.href).toBe(
        "https://apps.evinced.tech/mail",
      );
      expect(apps.find((a) => a.id === "dispatch")?.href).toBe(
        "https://apps.evinced.tech/dispatch/overview",
      );
      expect(apps.every((a) => !a.href.includes("agent-native.com"))).toBe(
        true,
      );
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  });

  it("keeps the first-party *.agent-native.com URLs when not path-prefixed", () => {
    // No VITE_APP_BASE_PATH → the app is served at its own root (subdomain
    // layout); keep the prod URLs.
    const apps = defaultOrgAppLinks({});
    expect(apps.find((a) => a.id === "mail")?.href).toBe(
      "https://mail.agent-native.com",
    );
  });

  it("normalizes workspace app manifests against the workspace gateway", () => {
    const apps = parseWorkspaceAppLinks(
      {
        apps: [
          { id: "mail", name: "Mail", path: "/mail" },
          { id: "dispatch", name: "Dispatch", path: "/dispatch" },
        ],
      },
      {
        VITE_AGENT_NATIVE_WORKSPACE: "1",
        VITE_WORKSPACE_GATEWAY_URL: "http://127.0.0.1:8080",
      },
    );

    expect(apps?.map((app) => app.id)).toEqual(["dispatch", "mail"]);
    expect(apps?.map((app) => app.icon)).toEqual(["MessageCircle", "Mail"]);
    expect(apps?.[0]?.href).toBe("http://127.0.0.1:8080/dispatch/overview");
    expect(apps?.[1]?.href).toBe("http://127.0.0.1:8080/mail");
    expect(dispatchAppsHref(apps ?? [])).toBe(
      "http://127.0.0.1:8080/dispatch/apps",
    );
  });

  it("caps visible app rows at nine while keeping overflow for Dispatch", () => {
    const apps = parseWorkspaceAppLinks({
      apps: [
        { id: "dispatch", name: "Dispatch", path: "/dispatch" },
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `app-${index + 1}`,
          name: `App ${index + 1}`,
          path: `/app-${index + 1}`,
        })),
      ],
    });

    const visible = visibleOrgAppLinks(apps ?? []);

    expect(visible.links).toHaveLength(9);
    expect(visible.links[0]?.id).toBe("dispatch");
    expect(visible.overflowCount).toBe(4);
  });
});
