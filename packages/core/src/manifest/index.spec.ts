// oracle-change(packages/core/src/manifest/server.spec.ts): Authorized discovery supersedes the standalone manifest and its inferred legacy metadata.
import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/discovery.json" with { type: "json" };
import {
  APP_CAPABILITIES_META_KEY,
  defineAppManifest,
  resolveAppCapabilities,
} from "./index.js";

describe("app capability discovery", () => {
  const mount = new URL("https://workspace.example.test/apps/docs/");

  it("keeps legacy and unknown versions on the existing tool catalog", () => {
    expect(resolveAppCapabilities(fixtures.legacy, mount)).toBeUndefined();
    expect(resolveAppCapabilities(fixtures.version2, mount)).toBeUndefined();
    expect(fixtures.legacy.tools.map((tool) => tool.name)).toEqual([
      "list-docs",
    ]);
  });

  it("resolves the same descriptor against each selected installation's mount", () => {
    const expected = {
      version: 1,
      screens: {
        library: {
          url: "https://workspace.example.test/apps/docs/library",
          action: "show-docs",
        },
      },
      suggestions: { "saved-view": "save-view" },
    };
    expect(resolveAppCapabilities(fixtures.version1, mount)).toEqual(expected);
    expect(
      resolveAppCapabilities(
        fixtures.version1,
        new URL("https://preview.example.test/custom/docs"),
      ),
    ).toEqual({
      ...expected,
      screens: {
        library: {
          url: "https://preview.example.test/custom/docs/library",
          action: "show-docs",
        },
      },
    });
  });

  it("ignores bindings absent from the current tool catalog", () => {
    expect(
      resolveAppCapabilities(
        { ...fixtures.version1, tools: fixtures.legacy.tools },
        mount,
      ),
    ).toBeUndefined();
  });

  it("adapts legacy manifest inputs without version to v1", () => {
    const adapted = defineAppManifest({
      id: "chat-app",
      displayName: "Chat App",
      screens: {
        defaultLandingScreen: "home",
        definitions: {
          home: { show: { route: "/home" } },
          thread: { show: { route: "/chat/:threadId" } },
        },
      },
      suggestableCapabilities: [
        { type: "saved-view", action: "save-view" },
        { type: "create-app", action: "create-app" },
      ],
    });
    expect(adapted).toEqual({
      version: 1,
      screens: { home: { route: "/home", action: "navigate" } },
      suggestions: { "saved-view": "save-view" },
    });
  });

  it.each(["//other.example.test", "/docs/../private", "/%2e%2e", "/docs/:id"])(
    "rejects route %s",
    (route) => {
      const descriptor = {
        version: 1 as const,
        screens: { library: { route, action: "show-docs" } },
      };
      expect(() => defineAppManifest(descriptor)).toThrow();
      expect(
        resolveAppCapabilities(
          {
            tools: [{ name: "show-docs" }],
            _meta: { [APP_CAPABILITIES_META_KEY]: descriptor },
          },
          mount,
        ),
      ).toBeUndefined();
    },
  );
});
