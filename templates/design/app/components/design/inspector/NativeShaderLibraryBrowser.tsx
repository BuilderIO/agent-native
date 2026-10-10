import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "@shared/native-effect-presets";
import type { EffectDefinition, EffectPreset } from "@shared/native-effects";
import { IconChevronDown, IconStar, IconWaveSine } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type {
  NativeThumbnailItem,
  NativeThumbnailResult,
} from "../native-thumbnail-plan";
import type { NativeThumbnailService } from "../native-thumbnail-service";
import {
  nativeCatalogBuiltinKey,
  nativeCatalogHistoricalBuiltinVersion,
  nativeCatalogPresetKey,
} from "./native-catalog-display";

type LibraryView = "all" | "favorites" | "recent";
interface BuiltinSummary {
  id: string;
  name: string;
  version: number;
  placements: string[];
  itemKey: string;
  favorite: boolean;
  lastUsedAt: string | null;
}
interface LibraryItem {
  id: string;
  itemKey: string;
  name: string;
  placements: string[];
  presetPlacement: string;
  favorite: boolean;
  lastUsedAt: string | null;
  executionHash: string;
  updatedAt: string;
}
interface LibraryResult {
  approvedDefinitionHashes: string[];
  library: {
    builtins: BuiltinSummary[];
    items: LibraryItem[];
    hasMore: boolean;
    nextCursor: string | null;
    selectedEntry: {
      definition: EffectDefinition;
      preset: EffectPreset;
    } | null;
  };
}

const initialBuiltins: BuiltinSummary[] = NATIVE_EFFECT_LATEST_DEFINITIONS.map(
  (definition) => ({
    id: definition.id,
    name: definition.name,
    version: definition.version,
    placements: definition.placements,
    itemKey: `builtin:${definition.id}@${definition.version}`,
    favorite: false,
    lastUsedAt: null,
  }),
);

interface NativeShaderLibraryBrowserProps {
  mode: "fill" | "effect";
  search: string;
  disabled: boolean;
  nodeId?: string;
  designId?: string;
  fileId?: string;
  onApplyBuiltin: (
    id: string,
    version: number,
    placement: "fill" | "layer" | "backdrop",
    preset?: EffectPreset,
  ) => Promise<boolean>;
  onApplySaved: (
    definition: EffectDefinition,
    preset: EffectPreset,
  ) => Promise<boolean>;
}

export function NativeShaderLibraryBrowser({
  mode,
  search,
  disabled,
  nodeId,
  designId,
  fileId,
  onApplyBuiltin,
  onApplySaved,
}: NativeShaderLibraryBrowserProps) {
  const t = useT();
  const [view, setView] = useState<LibraryView>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [builtins, setBuiltins] = useState<BuiltinSummary[]>(initialBuiltins);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const thumbnailService = useRef<NativeThumbnailService | null>(null);
  const [serviceReady, setServiceReady] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [thumbnails, setThumbnails] = useState<
    Record<string, NativeThumbnailResult | { status: "pending" }>
  >({});
  const [approvedHashes, setApprovedHashes] = useState<string[]>([]);
  const normalizedSearch = search.trim().slice(0, 100);

  useEffect(() => {
    let active = true;
    let service: NativeThumbnailService | null = null;
    void import("../native-thumbnail-service").then(
      (module) => {
        service = new module.NativeThumbnailService();
        if (active) {
          thumbnailService.current = service;
          setServiceReady(true);
        } else service.dispose();
      },
      () => {
        if (active) setServiceError(true);
      },
    );
    return () => {
      active = false;
      thumbnailService.current = null;
      service?.dispose();
    };
  }, []);

  useEffect(() => {
    setCursor(null);
    setItems([]);
    setBuiltins(view === "all" ? initialBuiltins : []);
  }, [view, normalizedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const request = {
        format: "native-v2",
        ...(designId && fileId
          ? { source: { kind: "design-file", designId, fileId } }
          : {}),
        includeLibrary: true,
        libraryView: view,
        librarySearch: normalizedSearch,
        libraryCursor: cursor ?? undefined,
      };
      const scoped = callAction<LibraryResult>("get-shader", request, {
        method: "GET",
        signal: controller.signal,
      });
      const allBuiltins =
        normalizedSearch && !cursor
          ? callAction<LibraryResult>(
              "get-shader",
              { ...request, librarySearch: "", libraryCursor: undefined },
              { method: "GET", signal: controller.signal },
            )
          : Promise.resolve(null);
      void Promise.all([scoped, allBuiltins])
        .then(([result, unfiltered]) => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(result.approvedDefinitionHashes))
            throw new Error("Shader approval state is unreadable");
          if (unfiltered && !Array.isArray(unfiltered.library.builtins))
            throw new Error("Shader Library builtins are unreadable");
          if (!cursor)
            setBuiltins(
              unfiltered?.library.builtins ?? result.library.builtins,
            );
          setApprovedHashes(result.approvedDefinitionHashes);
          setThumbnails({});
          setItems((current) =>
            cursor
              ? [...current, ...result.library.items]
              : result.library.items,
          );
          setNextCursor(
            result.library.hasMore ? result.library.nextCursor : null,
          );
          setLoadError(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoadError(true);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [view, normalizedSearch, cursor, revision, designId, fileId]);

  const toggleFavorite = async (itemKey: string, favorite: boolean) => {
    setBusyKey(itemKey);
    try {
      await callAction("edit-native-shader-library", {
        operation: { kind: "favorite", itemKey, favorite: !favorite },
      });
      setCursor(null);
      setRevision((current) => current + 1);
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("editPanel.shaders.libraryUnavailable"),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const markUsed = async (itemKey: string) => {
    try {
      await callAction("edit-native-shader-library", {
        operation: { kind: "mark-used", itemKey },
      });
      setCursor(null);
      setRevision((current) => current + 1);
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("editPanel.shaders.libraryUnavailable"),
      );
    }
  };

  const builtinRecipes = (entry: BuiltinSummary): EffectPreset[] => {
    return NATIVE_EFFECT_PRESETS.filter(
      (preset) =>
        preset.definitionId === entry.id &&
        preset.definitionVersion === entry.version &&
        (mode === "fill"
          ? preset.placement === "fill"
          : preset.placement !== "fill"),
    );
  };
  const presetLabel = (preset: EffectPreset): string => {
    const key = nativeCatalogPresetKey(preset);
    return `${key ? t(key) : preset.name} · v${preset.definitionVersion}`;
  };
  const applyBuiltin = async (entry: BuiltinSummary, preset?: EffectPreset) => {
    if (!nodeId) return;
    setBusyKey(entry.itemKey);
    try {
      const placement =
        preset?.placement ??
        (mode === "fill"
          ? "fill"
          : entry.placements.includes("backdrop")
            ? "backdrop"
            : "layer");
      const definitionId = preset?.definitionId ?? entry.id;
      const version = preset?.definitionVersion ?? entry.version;
      if (await onApplyBuiltin(definitionId, version, placement, preset))
        await markUsed(`builtin:${definitionId}@${version}`);
    } finally {
      setBusyKey(null);
    }
  };

  const applySaved = async (entry: LibraryItem) => {
    if (!nodeId) return;
    setBusyKey(entry.itemKey);
    try {
      const response = await callAction<LibraryResult>(
        "get-shader",
        {
          format: "native-v2",
          includeLibrary: true,
          includeSource: true,
          libraryEntryId: entry.id,
        },
        { method: "GET" },
      );
      const selected = response.library.selectedEntry;
      if (!selected?.preset)
        throw new Error(t("editPanel.shaders.libraryUnavailable"));
      if (
        Object.values(selected.preset.bindings ?? {}).some(
          (binding) => binding.kind === "authored-node",
        )
      )
        throw new Error(t("editPanel.shaders.librarySourceIncompatible"));
      if (await onApplySaved(selected.definition, selected.preset))
        await markUsed(entry.itemKey);
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("editPanel.shaders.libraryUnavailable"),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const builtinLabel = (entry: BuiltinSummary): string => {
    const key = nativeCatalogBuiltinKey(entry.id, entry.version);
    const name = key ? t(key) : entry.name;
    const historicalVersion = nativeCatalogHistoricalBuiltinVersion(
      entry.id,
      entry.version,
    );
    return historicalVersion === null
      ? name
      : `${name} · v${historicalVersion}`;
  };
  const entries = [
    ...builtins
      .filter(
        (entry) =>
          (entry.name.toLowerCase().includes(normalizedSearch.toLowerCase()) ||
            builtinLabel(entry)
              .toLowerCase()
              .includes(normalizedSearch.toLowerCase()) ||
            builtinRecipes(entry).some(
              (preset) =>
                preset.name
                  .toLowerCase()
                  .includes(normalizedSearch.toLowerCase()) ||
                presetLabel(preset)
                  .toLowerCase()
                  .includes(normalizedSearch.toLowerCase()),
            )) &&
          (entry.placements.includes(mode === "fill" ? "fill" : "layer") ||
            (mode === "effect" && entry.placements.includes("backdrop"))),
      )
      .map((entry) => ({ ...entry, builtin: true as const })),
    ...items
      .filter((entry) =>
        mode === "fill"
          ? entry.presetPlacement === "fill"
          : entry.presetPlacement !== "fill",
      )
      .map((entry) => ({ ...entry, builtin: false as const })),
  ];
  const entryKeys = entries.map((entry) => entry.itemKey).join("\u0000");
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      setVisibleKeys((current) => {
        const next = new Set(current);
        for (const item of observed) {
          const key = item.target.getAttribute("data-native-library-item-key");
          if (!key) continue;
          if (item.isIntersecting) next.add(key);
          else next.delete(key);
        }
        return next.size === current.size &&
          [...next].every((key) => current.has(key))
          ? current
          : next;
      });
    });
    grid
      .querySelectorAll<HTMLElement>("[data-native-library-item-key]")
      .forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [entryKeys]);

  useEffect(() => {
    const service = thumbnailService.current;
    if (!serviceReady || !service || visibleKeys.size === 0) return;
    const controller = new AbortController();
    const pending = entries.filter((entry) => visibleKeys.has(entry.itemKey));
    const renderVisible = async () => {
      for (let offset = 0; offset < pending.length; offset += 4) {
        if (controller.signal.aborted) return;
        const batch = pending.slice(offset, offset + 4);
        setThumbnails((current) => ({
          ...current,
          ...Object.fromEntries(
            batch.map((entry) => [entry.itemKey, { status: "pending" }]),
          ),
        }));
        const resolved = await Promise.all(
          batch.map(
            async (
              entry,
              index,
            ): Promise<{
              key: string;
              item?: NativeThumbnailItem;
              error?: NativeThumbnailResult;
            }> => {
              try {
                if (entry.builtin) {
                  const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
                    (candidate) =>
                      candidate.id === entry.id &&
                      candidate.version === entry.version,
                  );
                  if (!definition) throw new Error("Definition is unavailable");
                  return {
                    key: entry.itemKey,
                    item: {
                      id: `thumb-${index}`,
                      definition,
                      params: {},
                      seed: 1,
                      sourceRevision: entry.itemKey,
                    },
                  };
                }
                const exact = await callAction<LibraryResult>(
                  "get-shader",
                  {
                    format: "native-v2",
                    includeLibrary: true,
                    includeSource: true,
                    libraryEntryId: entry.id,
                    ...(designId && fileId
                      ? { source: { kind: "design-file", designId, fileId } }
                      : {}),
                  },
                  { method: "GET", signal: controller.signal },
                );
                const selected = exact.library.selectedEntry;
                if (!selected?.definition || !selected.preset)
                  throw new Error("Saved shader source is unavailable");
                if (Object.keys(selected.preset.bindings ?? {}).length)
                  throw new Error("Bound source needs the authored target");
                return {
                  key: entry.itemKey,
                  item: {
                    id: `thumb-${index}`,
                    definition: selected.definition,
                    params: selected.preset.params,
                    seed: 1,
                    sourceRevision: entry.executionHash,
                    sourceSizing: selected.preset.sourceSizing,
                  },
                };
              } catch (error) {
                return {
                  key: entry.itemKey,
                  error: {
                    id: `thumb-${index}`,
                    status: "error",
                    code: "thumbnail-source-unavailable",
                    message:
                      error instanceof Error ? error.message : String(error),
                  },
                };
              }
            },
          ),
        );
        if (controller.signal.aborted) return;
        const items = resolved.flatMap(({ item }) => (item ? [item] : []));
        const results = items.length
          ? await service.renderBatch({
              items,
              approvedExecutionHashes: approvedHashes,
              signal: controller.signal,
            })
          : [];
        if (controller.signal.aborted) return;
        const byId = new Map(results.map((result) => [result.id, result]));
        setThumbnails((current) => ({
          ...current,
          ...Object.fromEntries(
            resolved.map(({ key, item, error }) => [
              key,
              error ??
                (item ? byId.get(item.id) : undefined) ?? {
                  status: "error",
                  id: item?.id ?? "",
                  code: "thumbnail-result-missing",
                  message: "thumbnail-result-missing",
                },
            ]),
          ),
        }));
      }
    };
    void renderVisible().catch((error) => {
      if (controller.signal.aborted) return;
      setThumbnails((current) => ({
        ...current,
        ...Object.fromEntries(
          pending.map((entry) => [
            entry.itemKey,
            {
              id: entry.itemKey,
              status: "error",
              code: "thumbnail-render-failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ]),
        ),
      }));
    });
    return () => controller.abort();
  }, [entryKeys, visibleKeys, approvedHashes, designId, fileId, serviceReady]);
  const entryLabel = (entry: BuiltinSummary | LibraryItem) => {
    return "version" in entry ? builtinLabel(entry) : entry.name;
  };
  return (
    <section className="mb-3" aria-label={t("editPanel.shaders.libraryTitle")}>
      <div className="mb-1.5 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-muted-foreground">
          {t("editPanel.shaders.libraryTitle")}
        </span>
        {(["all", "favorites", "recent"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
            className={`rounded px-1.5 py-0.5 text-[10px] ${view === option ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t(
              `editPanel.shaders.library${option[0].toUpperCase()}${option.slice(1)}` as "editPanel.shaders.libraryAll",
            )}
          </button>
        ))}
      </div>
      {loadError ? (
        <p role="alert" className="py-2 text-xs text-destructive">
          {t("editPanel.shaders.libraryUnavailable")}
        </p>
      ) : null}
      {!loadError && entries.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          {t("editPanel.shaders.libraryNoItems")}
        </p>
      ) : null}
      <div ref={gridRef} className="grid grid-cols-2 gap-2">
        {entries.map((entry) => {
          const thumbnail = thumbnails[entry.itemKey];
          const recipes = entry.builtin ? builtinRecipes(entry) : [];
          const primary = entry.builtin
            ? recipes.find(
                (preset) => preset.definitionVersion === entry.version,
              )
            : undefined;
          return (
            <div
              key={entry.itemKey}
              data-native-library-item-key={entry.itemKey}
              data-native-thumbnail-status={thumbnail?.status ?? "pending"}
              className="min-w-0 rounded border border-border/60 p-1"
            >
              <button
                type="button"
                aria-label={entryLabel(entry)}
                disabled={disabled || busyKey !== null || !nodeId}
                onClick={() =>
                  void (entry.builtin
                    ? applyBuiltin(entry, primary)
                    : applySaved(entry))
                }
                className="block w-full min-w-0 text-left text-xs hover:text-foreground disabled:opacity-50"
              >
                <span className="mb-1 flex aspect-[8/5] items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
                  {thumbnail?.status === "ready" ? (
                    <img
                      src={thumbnail.objectUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : thumbnail?.status === "approval-required" ? (
                    <span className="px-1 text-center text-[10px]">
                      {t("editPanel.shaders.libraryThumbnailApproval")}
                    </span>
                  ) : thumbnail?.status === "error" || serviceError ? (
                    <span className="px-1 text-center text-[10px]">
                      {t("editPanel.shaders.libraryThumbnailUnavailable")}
                    </span>
                  ) : (
                    <IconWaveSine className="size-4" aria-hidden="true" />
                  )}
                </span>
                <span className="block truncate">{entryLabel(entry)}</span>
              </button>
              <div className="mt-0.5 flex items-center justify-between">
                <button
                  type="button"
                  disabled={disabled || busyKey !== null}
                  aria-label={t(
                    entry.favorite
                      ? "editPanel.shaders.libraryUnfavorite"
                      : "editPanel.shaders.libraryFavorite",
                  )}
                  onClick={() =>
                    void toggleFavorite(entry.itemKey, entry.favorite)
                  }
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <IconStar
                    className={`size-3.5 ${entry.favorite ? "fill-current text-primary" : ""}`}
                  />
                </button>
                {entry.builtin && recipes.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={disabled || busyKey !== null || !nodeId}
                        aria-label={t("editPanel.shaders.presets")}
                        className="flex items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {t("editPanel.shaders.presets")}
                        <IconChevronDown
                          className="size-3"
                          aria-hidden="true"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-h-64 overflow-y-auto"
                    >
                      {recipes.map((preset) => (
                        <DropdownMenuItem
                          key={preset.id}
                          onSelect={() => void applyBuiltin(entry, preset)}
                        >
                          {presetLabel(preset)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {nextCursor ? (
        <button
          type="button"
          onClick={() => setCursor(nextCursor)}
          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {t("editPanel.shaders.libraryMore")}
        </button>
      ) : null}
    </section>
  );
}
