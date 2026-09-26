import { afterEach, describe, expect, it, vi } from "vitest";

import { parseWorkspaceAppLinks } from "../client/org/workspace-app-links.js";
import {
  deriveAppIdentity,
  isFirstPartyApp,
  resolveAppHomePath,
} from "./app-identity.js";
import { getAppConfig, resetAppConfigForTests } from "./store.js";

const base = { packageName: undefined } as Parameters<
  typeof deriveAppIdentity
>[0];

describe("deriveAppIdentity", () => {
  afterEach(() => {
    resetAppConfigForTests();
    vi.unstubAllEnvs();
  });

  it("fills name, slug, and description from the first-party template table", () => {
    const app = deriveAppIdentity({ ...base, packageName: "mail" });
    expect(app.name).toBe("Mail");
    expect(app.slug).toBe("mail");
    expect(app.description).toBeTruthy();
  });

  it("emits nothing for a package the table does not know", () => {
    const app = deriveAppIdentity({ ...base, packageName: "@acme/thing" });
    expect(app.name).toBeUndefined();
    expect(app.slug).toBeUndefined();
  });

  it("emits nothing when no package name resolved at all", () => {
    expect(deriveAppIdentity(base).name).toBeUndefined();
  });

  it("never overrides an explicitly configured value", () => {
    const app = deriveAppIdentity({
      ...base,
      packageName: "mail",
      name: "Acme",
    });
    expect(app.name).toBe("Acme");
    expect(app.slug).toBe("mail");
  });

  it("does not treat a custom package as first-party after a template rename", () => {
    expect(
      isFirstPartyApp({
        ...base,
        packageName: "try-marisco",
        slug: "chat",
      }),
    ).toBe(false);
    expect(
      isFirstPartyApp({ ...base, packageName: "slides", slug: "slides" }),
    ).toBe(true);
  });

  it("does not treat a same-named app as first-party when its source differs", () => {
    expect(
      isFirstPartyApp({
        ...base,
        packageName: "slides",
        slug: "slides",
        sourceTemplate: "chat",
      }),
    ).toBe(false);
    expect(
      isFirstPartyApp({
        ...base,
        packageName: "slides",
        slug: "slides",
        sourceTemplate: "slides",
      }),
    ).toBe(true);
  });

  it("defaults apps to /home while allowing an explicit root opt-out", () => {
    expect(
      resolveAppHomePath({ ...base, packageName: "mail", slug: "mail" }),
    ).toBe("/home");
    expect(resolveAppHomePath({ ...base, packageName: "customer-crm" })).toBe(
      "/home",
    );
    expect(
      resolveAppHomePath({
        ...base,
        packageName: "test-standalone",
        sourceTemplate: "chat",
      }),
    ).toBe("/home");
    expect(
      resolveAppHomePath({
        ...base,
        packageName: "mail",
        slug: "mail",
        homePath: "/inbox",
      }),
    ).toBe("/inbox");
    expect(
      resolveAppHomePath({
        ...base,
        packageName: "customer-crm",
        homePath: "/",
      }),
    ).toBe("/");
  });

  it("follows the workspace manifest home for a root-only workspace app", () => {
    const appsJson = JSON.stringify([
      { id: "dispatch", path: "/dispatch", homePath: "/home" },
      { id: "adoption", path: "/adoption", homePath: "/" },
    ]);
    expect(
      resolveAppHomePath({ ...base, workspaceId: "adoption" }, {
        appsJson,
      } as Parameters<typeof resolveAppHomePath>[1]),
    ).toBe("/");
    expect(
      resolveAppHomePath({ ...base, workspaceId: "dispatch" }, {
        appsJson,
      } as Parameters<typeof resolveAppHomePath>[1]),
    ).toBe("/home");
    expect(
      resolveAppHomePath(
        { ...base, workspaceId: "adoption", homePath: "/inbox" },
        { appsJson } as Parameters<typeof resolveAppHomePath>[1],
      ),
    ).toBe("/inbox");
  });

  it("falls back to /home when the manifest has no usable entry", () => {
    const workspace = (appsJson: string) =>
      ({ appsJson }) as Parameters<typeof resolveAppHomePath>[1];
    const appsJson = JSON.stringify({
      apps: [{ id: "adoption", homePath: "/" }],
    });
    expect(resolveAppHomePath(base, workspace(appsJson))).toBe("/home");
    expect(
      resolveAppHomePath(
        { ...base, workspaceId: "missing" },
        workspace(appsJson),
      ),
    ).toBe("/home");
    expect(
      resolveAppHomePath(
        { ...base, workspaceId: "adoption" },
        workspace("not json"),
      ),
    ).toBe("/home");
    expect(
      resolveAppHomePath(
        { ...base, workspaceId: "adoption" },
        workspace(JSON.stringify([{ id: "adoption", homePath: "//evil" }])),
      ),
    ).toBe("/home");
  });

  it("resolves duplicate manifest ids the same way as the launcher", () => {
    const manifests = [
      [
        { id: "adoption", path: "/adoption", homePath: "/" },
        { id: "adoption", path: "/adoption", homePath: "/home" },
      ],
      [
        { id: "adoption", path: "/adoption", homePath: "/home" },
        { id: "adoption", path: "/adoption", homePath: "/" },
      ],
      [
        { id: "adoption", path: "/adoption" },
        { id: "adoption", path: "/adoption", homePath: "/" },
      ],
      [
        { id: " adoption ", path: "/adoption", homePath: "/" },
        { id: "adoption", path: "/adoption", homePath: "/home" },
      ],
    ];
    for (const manifest of manifests) {
      const homePath = resolveAppHomePath(
        { ...base, workspaceId: "adoption" },
        { appsJson: JSON.stringify(manifest) } as Parameters<
          typeof resolveAppHomePath
        >[1],
      );
      const link = parseWorkspaceAppLinks(manifest, {})?.find(
        (app) => app.id === "adoption",
      );
      expect(link?.href).toBe(
        homePath === "/" ? "/adoption" : `/adoption${homePath}`,
      );
    }
  });

  it("reads the manifest home from resolved workspace env", () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", "adoption");
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "adoption", path: "/adoption", homePath: "/" }]),
    );
    resetAppConfigForTests();
    const config = getAppConfig();
    expect(resolveAppHomePath(config.app, config.workspace)).toBe("/");
  });

  it("runs on the resolved config, so APP_NAME still wins", () => {
    vi.stubEnv("npm_package_name", "mail");
    vi.stubEnv("APP_NAME", "Acme Mail");
    resetAppConfigForTests();
    expect(getAppConfig().app.name).toBe("Acme Mail");
    expect(getAppConfig().app.slug).toBe("mail");
  });

  it("reads no files, so getAppConfig() stays a pure in-memory resolve", async () => {
    const fs = await import("node:fs");
    const dir = "src/app-config";
    const importsFs = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
      .filter((f) =>
        /^\s*import[^;]*from\s+"node:(fs|path)"/m.test(
          fs.readFileSync(`${dir}/${f}`, "utf8"),
        ),
      );
    expect(importsFs).toEqual([]);
  });
});
