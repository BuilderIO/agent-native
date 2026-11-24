// oracle-change(packages/core/src/manifest/server.spec.ts): Authorized discovery supersedes the standalone manifest and its inferred legacy metadata.
import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/discovery.json" with { type: "json" };
import {
  APP_CAPABILITIES_META_KEY,
  defineAppManifest,
  expandManifestRoute,
  matchManifestRoute,
  projectAppManifest,
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

  it("adapts legacy metadata fields, trims strings, and filters invalid entries", () => {
    const adapted = defineAppManifest({
      id: "decks-app",
      displayName: "Decks",
      supportsViewOverlay: true,
      viewPolicy: {
        defaultMode: "open",
        allowBackgroundNavigation: false,
        fallbackScreen: "home",
      },
      entities: {
        deck: {
          screen: "deck",
          route: "/docs/:deckId",
          idParam: "deckId",
          label: "Deck",
        },
      },
      screens: {
        definitions: {
          home: {
            show: {
              route: "/",
              action: "  open-home  ",
              supportsViewOverlay: false,
            },
          },
          deck: {
            show: {
              route: "/docs/:deckId",
              action: "   ",
              supportsViewOverlay: true,
            },
          },
          bad: {
            show: {
              route: "/docs/../nope",
            },
          },
        },
      },
      suggestableCapabilities: [
        {
          type: "  saved-view  ",
          action: "  save-view  ",
          description: "  Save current filter  ",
        },
        {
          type: "custom-widget",
          action: "create-widget",
          description: "   ",
        },
        { type: "   ", action: "noop" },
        { type: "missing-action", action: "   " },
      ],
    });

    expect(adapted).toEqual({
      version: 1,
      screens: {
        home: { route: "/", action: "open-home", supportsViewOverlay: false },
        deck: {
          route: "/docs/:deckId",
          action: "navigate",
          supportsViewOverlay: true,
        },
      },
      suggestions: { "saved-view": "save-view" },
      entities: {
        deck: {
          screen: "deck",
          route: "/docs/:deckId",
          idParam: "deckId",
          label: "Deck",
        },
      },
      viewPolicy: {
        defaultMode: "open",
        allowBackgroundNavigation: false,
        fallbackScreen: "home",
      },
      suggestableCapabilities: [
        {
          type: "saved-view",
          action: "save-view",
          description: "Save current filter",
        },
        {
          type: "custom-widget",
          action: "create-widget",
        },
      ],
      supportsViewOverlay: true,
    });

    const minimalLegacy = defineAppManifest({
      id: "empty-meta",
      displayName: "Empty",
      entities: {},
      suggestableCapabilities: [{ type: "saved-view", action: "save-view" }],
    });
    expect(minimalLegacy).toEqual({
      version: 1,
      suggestions: { "saved-view": "save-view" },
    });
    expect(minimalLegacy.entities).toBeUndefined();
    expect(minimalLegacy.suggestableCapabilities).toBeUndefined();
    expect(minimalLegacy.supportsViewOverlay).toBeUndefined();
  });

  it("projects and resolves v2 manifests including suggestableCapabilities and screen params", () => {
    const manifest = defineAppManifest({
      version: 2,
      screens: {
        deck: {
          route: "/docs/:deckId",
          action: "show-deck",
          params: { deckId: "string" },
          supportsViewOverlay: false,
        },
      },
      suggestableCapabilities: [
        {
          type: "export-pdf",
          action: "export-deck",
          description: "Export deck as PDF",
        },
      ],
      entities: {
        deck: { route: "/docs/:deckId", screen: "deck" },
      },
      viewPolicy: { defaultMode: "keep" },
      supportsViewOverlay: false,
    });

    expect(
      projectAppManifest(undefined, [{ name: "show-deck" }]),
    ).toBeUndefined();
    expect(
      projectAppManifest(manifest, [{ name: "unrelated" }]),
    ).toBeUndefined();

    const capOnly = projectAppManifest(manifest, [{ name: "export-deck" }]);
    expect(capOnly).toEqual({
      version: 2,
      suggestableCapabilities: [
        {
          type: "export-pdf",
          action: "export-deck",
          description: "Export deck as PDF",
        },
      ],
      entities: { deck: { route: "/docs/:deckId", screen: "deck" } },
      viewPolicy: { defaultMode: "keep" },
      supportsViewOverlay: false,
    });

    const resolved = resolveAppCapabilities(
      {
        tools: [{ name: "show-deck" }, { name: "export-deck" }],
        _meta: { [APP_CAPABILITIES_META_KEY]: manifest },
      },
      mount,
    );
    expect(resolved).toEqual({
      version: 2,
      screens: {
        deck: {
          action: "show-deck",
          url: "https://workspace.example.test/apps/docs/docs/:deckId",
          route: "/docs/:deckId",
          params: { deckId: "string" },
          supportsViewOverlay: false,
        },
      },
      entities: { deck: { route: "/docs/:deckId", screen: "deck" } },
      viewPolicy: { defaultMode: "keep" },
      suggestableCapabilities: [
        {
          type: "export-pdf",
          action: "export-deck",
          description: "Export deck as PDF",
        },
      ],
      supportsViewOverlay: false,
    });
  });

  it("handles edge cases in matchManifestRoute, expandManifestRoute, validateAppManifestPath, and resolveManifestScreenPath", () => {
    expect(
      matchManifestRoute("/docs/:deckId", "/docs/hello%20world?slide=2#top"),
    ).toEqual({
      matched: true,
      params: { deckId: "hello world" },
    });
    expect(matchManifestRoute("/docs/:deckId", "/docs/%E0%A4%A")).toEqual({
      matched: true,
      params: { deckId: "%E0%A4%A" },
    });
    expect(matchManifestRoute("/docs/:deckId", "/other/123")).toEqual({
      matched: false,
    });
    expect(matchManifestRoute("/docs/:deckId", "/docs/123/extra")).toEqual({
      matched: false,
    });
    expect(matchManifestRoute("/", "/")).toEqual({
      matched: true,
      params: {},
    });

    expect(expandManifestRoute("/", { tab: "all" })).toEqual({
      path: "/",
      remainingParams: { tab: "all" },
    });
    expect(expandManifestRoute("/docs/:deckId", { deckId: "  a/b  " })).toEqual(
      {
        path: "/docs/a%2Fb",
        remainingParams: {},
      },
    );
    expect(expandManifestRoute("/docs/:deckId", { deckId: "   " })).toEqual({
      error:
        'Missing required route parameter(s) :deckId for template "/docs/:deckId".',
    });
    expect(expandManifestRoute("/docs/:deckId/:slideId")).toEqual({
      error:
        'Missing required route parameter(s) :deckId, :slideId for template "/docs/:deckId/:slideId".',
    });

    const emptyManifest = defineAppManifest({ version: 2 });
    expect(validateAppManifestPath(emptyManifest, "/anything")).toEqual({
      valid: true,
    });
    expect(resolveManifestScreenPath(emptyManifest, "missing")).toEqual({
      error: 'Unknown screen "missing".',
      validScreens: [],
    });

    const entityManifest = defineAppManifest({
      version: 2,
      screens: {
        library: { route: "/library", action: "navigate" },
      },
      entities: {
        deck: { route: "/docs/:deckId", screen: "deck-editor" },
        note: { route: "/notes/:noteId" },
        tag: { label: "Tag" },
      },
    });
    expect(validateAppManifestPath(entityManifest, "/")).toEqual({
      valid: true,
    });
    expect(validateAppManifestPath(entityManifest, "/docs/d-1")).toEqual({
      valid: true,
      screenId: "deck-editor",
      params: { deckId: "d-1" },
    });
    expect(validateAppManifestPath(entityManifest, "/notes/n-2")).toEqual({
      valid: true,
      screenId: "note",
      params: { noteId: "n-2" },
    });
    expect(resolveManifestScreenPath(entityManifest, "unknown")).toEqual({
      error: 'Unknown screen "unknown". Valid screens: library (/library).',
      validScreens: [{ screenId: "library", route: "/library" }],
    });

    const homeManifest = defineAppManifest({
      version: 2,
      screens: {
        home: { route: "/", action: "navigate" },
        deck: { route: "/docs/:deckId", action: "navigate" },
      },
    });
    expect(validateAppManifestPath(homeManifest, "/")).toEqual({
      valid: true,
      screenId: "home",
      params: {},
    });
    expect(resolveManifestScreenPath(homeManifest, "deck", {})).toEqual({
      error:
        'Missing required route parameter(s) :deckId for template "/docs/:deckId".',
      validScreens: [
        { screenId: "home", route: "/" },
        { screenId: "deck", route: "/docs/:deckId" },
      ],
    });
  });
});
