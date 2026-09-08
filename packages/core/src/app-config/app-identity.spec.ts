import { afterEach, describe, expect, it, vi } from "vitest";

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
    // The shape a serverless bundle produces when the resolved package name is
    // a bundler artifact rather than the app's own.
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
    // ...while still filling the fields that were left unset.
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
