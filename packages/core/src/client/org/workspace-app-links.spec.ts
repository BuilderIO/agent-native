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

    expect(apps).toHaveLength(9);
    expect(apps[0]).toMatchObject({
      id: "dispatch",
      name: "Dispatch",
      isDispatch: true,
      href: "https://dispatch.agent-native.com/overview",
    });
    expect(apps.map((app) => app.id)).toEqual(
      expect.arrayContaining([
        "analytics",
        "calendar",
        "clips",
        "content",
        "design",
        "forms",
        "mail",
        "slides",
      ]),
    );
    expect(apps.map((app) => app.id)).not.toContain("starter");
    expect(apps.map((app) => app.id)).not.toContain("videos");
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
