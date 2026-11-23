// oracle-change(packages/core/src/manifest/server.spec.ts): Authorized discovery supersedes the standalone manifest and its inferred legacy metadata.
import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/discovery.json" with { type: "json" };
import {
  APP_CAPABILITIES_META_KEY,
  defineAppManifest,
  expandManifestRoute,
  matchManifestRoute,
  resolveAppCapabilities,
  resolveManifestScreenPath,
  validateAppManifestPath,
} from "./index.js";

describe("app capability discovery", () => {
  const mount = new URL("https://workspace.example.test/apps/docs/");

  it("keeps legacy and unknown versions on the existing tool catalog", () => {
    expect(resolveAppCapabilities(fixtures.legacy, mount)).toBeUndefined();
    expect(resolveAppCapabilities(fixtures.version3, mount)).toBeUndefined();
    expect(fixtures.legacy.tools.map((tool) => tool.name)).toEqual([
      "list-docs",
    ]);
  });

  it("resolves v2 manifests with parameterized :param routes and v2 metadata", () => {
    expect(resolveAppCapabilities(fixtures.version2, mount)).toEqual({
      version: 2,
      screens: {
        library: {
          url: "https://workspace.example.test/apps/docs/library",
          route: "/library",
          action: "show-docs",
        },
        doc: {
          url: "https://workspace.example.test/apps/docs/docs/:deckId",
          route: "/docs/:deckId",
          action: "show-docs",
          supportsViewOverlay: true,
        },
      },
      entities: {
        deck: {
          screen: "doc",
          route: "/docs/:deckId",
          idParam: "deckId",
          label: "Deck",
        },
      },
      viewPolicy: {
        defaultMode: "reveal",
        allowBackgroundNavigation: false,
      },
      supportsViewOverlay: true,
    });
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

  it("adapts legacy manifest inputs without version to v1 while preserving :param routes", () => {
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
      screens: {
        home: { route: "/home", action: "navigate" },
        thread: { route: "/chat/:threadId", action: "navigate" },
      },
      suggestions: { "saved-view": "save-view" },
      suggestableCapabilities: [
        { type: "saved-view", action: "save-view" },
        { type: "create-app", action: "create-app" },
      ],
    });
  });

  it("supports parameterized v2 templates and validates/expands concrete routes", () => {
    const manifest = defineAppManifest({
      version: 2,
      screens: {
        home: { route: "/", action: "navigate" },
        deck: { route: "/docs/:deckId", action: "navigate" },
        thread: { route: "/thread/:threadId", action: "navigate" },
        issue: { route: "/issue/:issueId", action: "navigate" },
        day: { route: "/day/:date", action: "navigate" },
        split: { route: "/split/:splitId", action: "navigate" },
      },
      supportsViewOverlay: true,
    });

    expect(matchManifestRoute("/docs/:deckId", "/docs/q3-roadmap")).toEqual({
      matched: true,
      params: { deckId: "q3-roadmap" },
    });
    expect(
      expandManifestRoute("/docs/:deckId", { deckId: "q3", slide: 2 }),
    ).toEqual({
      path: "/docs/q3",
      remainingParams: { slide: 2 },
    });
    expect(validateAppManifestPath(manifest, "/docs/q3-roadmap")).toEqual({
      valid: true,
      screenId: "deck",
      params: { deckId: "q3-roadmap" },
    });
    expect(validateAppManifestPath(manifest, "/day/2026-11-23")).toEqual({
      valid: true,
      screenId: "day",
      params: { date: "2026-11-23" },
    });
    const invalid = validateAppManifestPath(manifest, "/does/not/exist");
    expect(invalid).toEqual({
      valid: false,
      validTemplates: expect.arrayContaining([
        expect.objectContaining({ screenId: "deck", route: "/docs/:deckId" }),
      ]),
    });
    expect(
      resolveManifestScreenPath(manifest, "issue", {
        issueId: "ENG-42",
        tab: "comments",
      }),
    ).toEqual({
      path: "/issue/ENG-42",
      remainingParams: { tab: "comments" },
    });
    const missingParam = resolveManifestScreenPath(manifest, "deck", {});
    expect("error" in missingParam && missingParam.error).toContain(":deckId");
  });

  it.each([
    "//other.example.test",
    "/docs/../private",
    "/%2e%2e",
    "/docs/:",
    "/docs/:123",
    "/docs/:id/sub/:id",
  ])("rejects route %s", (route) => {
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
  });
});
