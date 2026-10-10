import {
  GRAIN_GRADIENT_EFFECT,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
  NATIVE_COORDINATE_RANDOM_PRESET_SOURCE_IDS,
} from "@shared/native-effect-presets";
// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
const showError = vi.hoisted(() => vi.fn());
const renderThumbnailBatch = vi.hoisted(() => vi.fn());
const disposeThumbnails = vi.hoisted(() => vi.fn());
const locale = vi.hoisted(() => ({ grainName: null as string | null }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "editPanel.shaders.nativeCatalog.definitions.grain-gradient" &&
    locale.grainName
      ? locale.grainName
      : key,
}));
vi.mock("sonner", () => ({ toast: { error: showError } }));
vi.mock("../native-thumbnail-service", () => ({
  NativeThumbnailService: class {
    renderBatch = renderThumbnailBatch;
    dispose = disposeThumbnails;
  },
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  );
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect?: () => void;
    }) => (
      <button type="button" role="menuitem" onClick={onSelect}>
        {children}
      </button>
    ),
  };
});

import { NativeShaderLibraryBrowser } from "./NativeShaderLibraryBrowser";

describe("NativeShaderLibraryBrowser", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    callAction.mockReset();
    showError.mockReset();
    renderThumbnailBatch.mockReset();
    disposeThumbnails.mockReset();
    locale.grainName = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("uses the canonical list and refuses a saved binding pinned to another authored node", async () => {
    const onApplyBuiltin = vi.fn().mockResolvedValue(true);
    const onApplySaved = vi.fn().mockResolvedValue(true);
    callAction.mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        if (name === "get-shader" && args.libraryEntryId)
          return Promise.resolve({
            library: {
              selectedEntry: {
                definition: GRAIN_GRADIENT_EFFECT,
                preset: {
                  id: "saved-preset",
                  definitionId: GRAIN_GRADIENT_EFFECT.id,
                  definitionVersion: GRAIN_GRADIENT_EFFECT.version,
                  placement: "fill",
                  params: {},
                  clip: "bounds",
                  bindings: {
                    source: {
                      kind: "authored-node",
                      nodeId: "another-node",
                      capture: "content",
                    },
                  },
                  provenance: { origin: "user-authored" },
                },
              },
            },
          });
        if (name === "get-shader")
          return Promise.resolve({
            approvedDefinitionHashes: [],
            library: {
              builtins: [
                {
                  id: GRAIN_GRADIENT_EFFECT.id,
                  name: GRAIN_GRADIENT_EFFECT.name,
                  version: GRAIN_GRADIENT_EFFECT.version,
                  placements: ["fill"],
                  itemKey: `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`,
                  favorite: true,
                  lastUsedAt: null,
                },
              ],
              items: [
                {
                  id: "saved",
                  itemKey: "library:saved",
                  name: "Saved material",
                  placements: ["fill"],
                  presetPlacement: "fill",
                  favorite: false,
                  lastUsedAt: null,
                },
              ],
              hasMore: false,
              nextCursor: null,
              selectedEntry: null,
            },
          });
        return Promise.resolve({});
      },
    );
    await act(async () => {
      root.render(
        <NativeShaderLibraryBrowser
          mode="fill"
          search=""
          disabled={false}
          nodeId="target"
          onApplyBuiltin={onApplyBuiltin}
          onApplySaved={onApplySaved}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    const saved = host.querySelector<HTMLButtonElement>(
      '[aria-label="Saved material"]',
    );
    expect(saved).not.toBeNull();
    await act(async () => saved!.click());
    expect(onApplySaved).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      "editPanel.shaders.librarySourceIncompatible",
    );
    const builtin = host.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.shaders.nativeCatalog.definitions.grain-gradient · v2"]',
    );
    expect(builtin).not.toBeNull();
    await act(async () => builtin!.click());
    expect(onApplyBuiltin).toHaveBeenCalledWith(
      GRAIN_GRADIENT_EFFECT.id,
      GRAIN_GRADIENT_EFFECT.version,
      "fill",
      expect.objectContaining({ id: "an-preset-orange-cream-grain" }),
    );
    expect(callAction).toHaveBeenCalledWith("edit-native-shader-library", {
      operation: {
        kind: "mark-used",
        itemKey: `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`,
      },
    });
    const favorite = host.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.shaders.libraryUnfavorite"]',
    );
    expect(favorite).not.toBeNull();
    await act(async () => favorite!.click());
    expect(callAction).toHaveBeenCalledWith("edit-native-shader-library", {
      operation: {
        kind: "favorite",
        itemKey: `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`,
        favorite: false,
      },
    });
  });

  it("starts with every latest fill definition before the action read resolves", async () => {
    callAction.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      root.render(
        <NativeShaderLibraryBrowser
          mode="fill"
          search=""
          disabled={false}
          nodeId="target"
          onApplyBuiltin={vi.fn()}
          onApplySaved={vi.fn()}
        />,
      );
    });
    expect(
      host.querySelectorAll("[data-native-library-item-key]"),
    ).toHaveLength(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) =>
        definition.placements.includes("fill"),
      ).length,
    );
    expect(
      host.querySelector(
        '[data-native-library-item-key="builtin:an-native-grain-gradient@4"]',
      ),
    ).not.toBeNull();
  });

  it.each(["an-native-luminous-perimeter", "an-native-focal-color-field"])(
    "discovers and applies %s in the normal Fill picker",
    async (id) => {
      const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (d) => d.id === id,
      )!;
      const recipe = NATIVE_EFFECT_PRESETS.find(
        (p) =>
          p.definitionId === id && p.definitionVersion === definition.version,
      )!;
      const onApplyBuiltin = vi.fn().mockResolvedValue(true);
      callAction.mockImplementation((name: string) =>
        name === "get-shader"
          ? Promise.resolve({
              approvedDefinitionHashes: [],
              library: {
                builtins: [],
                items: [],
                hasMore: false,
                nextCursor: null,
                selectedEntry: null,
              },
            })
          : Promise.resolve({}),
      );
      await act(async () =>
        root.render(
          <NativeShaderLibraryBrowser
            mode="fill"
            search=""
            disabled={false}
            nodeId="target"
            onApplyBuiltin={onApplyBuiltin}
            onApplySaved={vi.fn()}
          />,
        ),
      );
      const tile = host.querySelector<HTMLElement>(
        `[data-native-library-item-key="builtin:${id}@1"]`,
      );
      expect(tile).not.toBeNull();
      const apply = tile!.querySelector<HTMLButtonElement>("button");
      expect(apply?.getAttribute("aria-label")).toBe(
        `editPanel.shaders.nativeCatalog.definitions.${id.slice("an-native-".length)}`,
      );
      await act(async () => apply!.click());
      expect(onApplyBuiltin).toHaveBeenCalledWith(id, 1, "fill", recipe);
      expect(callAction).toHaveBeenCalledWith(
        "edit-native-shader-library",
        expect.objectContaining({
          operation: { kind: "mark-used", itemKey: `builtin:${id}@1` },
        }),
      );
    },
  );

  it("labels a favorited older version and applies its exact pinned recipe", async () => {
    const latest = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (definition) => definition.id === GRAIN_GRADIENT_EFFECT.id,
    )!;
    const onApplyBuiltin = vi.fn().mockResolvedValue(true);
    callAction.mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        if (name !== "get-shader") return Promise.resolve({});
        const historical = args.libraryView === "favorites";
        const version = historical
          ? GRAIN_GRADIENT_EFFECT.version
          : latest.version;
        return Promise.resolve({
          approvedDefinitionHashes: [],
          library: {
            builtins: [
              {
                id: latest.id,
                name: latest.name,
                version,
                placements: ["fill"],
                itemKey: `builtin:${latest.id}@${version}`,
                favorite: historical,
                lastUsedAt: historical ? "2026-10-07T02:00:00.000Z" : null,
              },
            ],
            items: [],
            hasMore: false,
            nextCursor: null,
            selectedEntry: null,
          },
        });
      },
    );
    await act(async () => {
      root.render(
        <NativeShaderLibraryBrowser
          mode="fill"
          search=""
          disabled={false}
          nodeId="target"
          onApplyBuiltin={onApplyBuiltin}
          onApplySaved={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    expect(
      host.querySelectorAll(
        `[data-native-library-item-key^="builtin:${latest.id}@"]`,
      ),
    ).toHaveLength(1);
    const favorites = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (button) => button.textContent === "editPanel.shaders.libraryFavorites",
    );
    expect(favorites).toBeDefined();
    await act(async () => favorites!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    const older = host.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.shaders.nativeCatalog.definitions.grain-gradient · v2"]',
    );
    expect(older).not.toBeNull();
    await act(async () => older!.click());
    expect(onApplyBuiltin).toHaveBeenCalledWith(
      latest.id,
      2,
      "fill",
      expect.objectContaining({ id: "an-preset-orange-cream-grain" }),
    );
  });

  it("offers only exact successor recipes for latest cards and applies their localized pinned identity", async () => {
    const grain = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (definition) => definition.id === "an-native-grain-gradient",
    )!;
    const successorId = Object.entries(
      NATIVE_COORDINATE_RANDOM_PRESET_SOURCE_IDS,
    ).find(([, source]) => source === "an-preset-v3-grain-gradient-2")?.[0];
    expect(successorId).toBeDefined();
    const recipe = NATIVE_EFFECT_PRESETS.find(
      (preset) => preset.id === successorId,
    )!;
    const onApplyBuiltin = vi.fn().mockResolvedValue(true);
    callAction.mockImplementation((name: string) =>
      name === "get-shader"
        ? Promise.resolve({
            approvedDefinitionHashes: [],
            library: {
              builtins: [
                {
                  id: grain.id,
                  name: grain.name,
                  version: grain.version,
                  placements: grain.placements,
                  itemKey: `builtin:${grain.id}@${grain.version}`,
                  favorite: false,
                  lastUsedAt: null,
                },
              ],
              items: [],
              hasMore: false,
              nextCursor: null,
              selectedEntry: null,
            },
          })
        : Promise.resolve({}),
    );
    await act(async () => {
      root.render(
        <NativeShaderLibraryBrowser
          mode="fill"
          search=""
          disabled={false}
          nodeId="target"
          onApplyBuiltin={onApplyBuiltin}
          onApplySaved={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    const variants = host.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.shaders.presets"]',
    );
    expect(variants).not.toBeNull();
    await act(async () => variants!.click());
    const options = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ];
    expect(options).toHaveLength(3);
    expect(options.every((item) => item.textContent?.endsWith(" · v4"))).toBe(
      true,
    );
    const option = options.find((item) =>
      item.textContent?.includes(
        "nativeCatalog.presets.an-preset-catalog-grain-gradient-2 · v4",
      ),
    );
    expect(option).not.toBeUndefined();
    await act(async () => option!.click());
    expect(onApplyBuiltin).toHaveBeenCalledWith(grain.id, 4, "fill", recipe);
  });

  it("finds a localized builtin while retaining server search for saved names", async () => {
    locale.grainName = "Farbverlauf";
    callAction.mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        if (name !== "get-shader") return Promise.resolve({});
        return Promise.resolve({
          approvedDefinitionHashes: [],
          library: {
            builtins:
              args.librarySearch === ""
                ? [
                    {
                      id: GRAIN_GRADIENT_EFFECT.id,
                      name: GRAIN_GRADIENT_EFFECT.name,
                      version: GRAIN_GRADIENT_EFFECT.version,
                      placements: ["fill"],
                      itemKey: `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`,
                      favorite: false,
                      lastUsedAt: null,
                    },
                  ]
                : [],
            items: [],
            hasMore: false,
            nextCursor: null,
            selectedEntry: null,
          },
        });
      },
    );
    await act(async () => {
      root.render(
        <NativeShaderLibraryBrowser
          mode="fill"
          search="Farbverlauf"
          disabled={false}
          nodeId="target"
          onApplyBuiltin={vi.fn()}
          onApplySaved={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Farbverlauf · v2"]'),
    ).not.toBeNull();
    expect(
      callAction.mock.calls.some(
        ([name, args]) =>
          name === "get-shader" && args.librarySearch === "Farbverlauf",
      ),
    ).toBe(true);
    expect(
      callAction.mock.calls.some(
        ([name, args]) => name === "get-shader" && args.librarySearch === "",
      ),
    ).toBe(true);
  });

  it("renders a visible built-in tile through one GPU thumbnail batch", async () => {
    let observe:
      | ((items: Array<{ target: Element; isIntersecting: boolean }>) => void)
      | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (
            items: Array<{ target: Element; isIntersecting: boolean }>,
          ) => void,
        ) {
          observe = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    callAction.mockResolvedValue({
      approvedDefinitionHashes: [],
      library: {
        builtins: [
          {
            id: GRAIN_GRADIENT_EFFECT.id,
            name: GRAIN_GRADIENT_EFFECT.name,
            version: GRAIN_GRADIENT_EFFECT.version,
            placements: ["fill"],
            itemKey: `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`,
            favorite: false,
            lastUsedAt: null,
          },
        ],
        items: [],
        hasMore: false,
        nextCursor: null,
        selectedEntry: null,
      },
    });
    renderThumbnailBatch.mockResolvedValue([
      {
        id: "thumb-0",
        status: "ready",
        objectUrl: "blob:gpu-thumbnail",
        executionHash: "a".repeat(64),
      },
    ]);
    await act(async () => {
      root.render(
        <NativeShaderLibraryBrowser
          mode="fill"
          search=""
          disabled={false}
          nodeId="target"
          designId="design-1"
          fileId="file-1"
          onApplyBuiltin={vi.fn()}
          onApplySaved={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    const card = host.querySelector("[data-native-library-item-key]");
    expect(card).not.toBeNull();
    await act(async () => observe?.([{ target: card!, isIntersecting: true }]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderThumbnailBatch).toHaveBeenCalledOnce();
    expect(renderThumbnailBatch.mock.calls[0]?.[0].items).toMatchObject([
      {
        definition: { id: GRAIN_GRADIENT_EFFECT.id, version: 2 },
        sourceRevision: `builtin:${GRAIN_GRADIENT_EFFECT.id}@2`,
      },
    ]);
    expect(host.querySelector('img[src="blob:gpu-thumbnail"]')).not.toBeNull();
    vi.unstubAllGlobals();
  });
});
