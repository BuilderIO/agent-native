import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBrowserTabId,
  readClientAppState,
  setAgentChatContextItem,
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client";
import {
  GENERATION_CONTEXT_STATE_KEY,
  LEGACY_IMAGE_MODEL_STATE_KEY,
  generationContextPromptBlock,
  normalizeGenerationContext,
  type GenerationContext,
} from "@/lib/generation-context";
import type {
  GenerationPresetSummary,
  ImageLibrarySummary,
} from "../../shared/api";

const GENERATION_CONTEXT_CHAT_KEY = "assets-generation-context";

type LibraryListResult = {
  libraries?: ImageLibrarySummary[];
};

type PresetListResult = {
  presets?: GenerationPresetSummary[];
};

function tabScopedGenerationContextKey(tabId = getBrowserTabId()) {
  return `${GENERATION_CONTEXT_STATE_KEY}:${tabId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function globalFormatContext(context: GenerationContext): GenerationContext {
  return {
    ...context,
    libraryId: null,
    presetId: null,
  };
}

function scopedLibraryContext(context: GenerationContext) {
  return {
    libraryId: context.libraryId,
    presetId: context.presetId,
  };
}

function mergeGenerationContextState({
  globalRaw,
  scopedRaw,
  legacyRaw,
}: {
  globalRaw: unknown;
  scopedRaw: unknown;
  legacyRaw: unknown;
}): GenerationContext {
  const globalContext = normalizeGenerationContext(globalRaw, legacyRaw);
  const scopedContext = normalizeGenerationContext(scopedRaw, legacyRaw);
  const scopedRecord = isRecord(scopedRaw) ? scopedRaw : null;
  const useScopedLibrary = Boolean(
    scopedRecord &&
    (hasOwn(scopedRecord, "libraryId") || hasOwn(scopedRecord, "presetId")),
  );

  return {
    libraryId: useScopedLibrary
      ? scopedContext.libraryId
      : globalContext.libraryId,
    presetId: useScopedLibrary
      ? scopedContext.presetId
      : globalContext.presetId,
    model: globalContext.model,
    aspectRatio: globalContext.aspectRatio,
    imageSize: globalContext.imageSize,
    count: globalContext.count,
    mediaType: globalContext.mediaType,
    videoDurationSeconds: globalContext.videoDurationSeconds,
    videoResolution: globalContext.videoResolution,
  };
}

export function generationContextQueryKey() {
  return [
    "app-state",
    GENERATION_CONTEXT_STATE_KEY,
    getBrowserTabId(),
  ] as const;
}

export async function readClientGenerationContext(
  options: {
    signal?: AbortSignal;
  } = {},
) {
  const scopedKey = tabScopedGenerationContextKey();
  const [globalRaw, scopedRaw, legacyRaw] = await Promise.all([
    readClientAppState(GENERATION_CONTEXT_STATE_KEY, {
      signal: options.signal,
    }).catch(() => null),
    readClientAppState(scopedKey, { signal: options.signal }).catch(() => null),
    readClientAppState(LEGACY_IMAGE_MODEL_STATE_KEY, {
      signal: options.signal,
    }).catch(() => null),
  ]);
  return mergeGenerationContextState({ globalRaw, scopedRaw, legacyRaw });
}

export async function writeClientGenerationContext(context: GenerationContext) {
  const tabId = getBrowserTabId();
  await Promise.all([
    writeClientAppState(
      GENERATION_CONTEXT_STATE_KEY,
      globalFormatContext(context),
      { requestSource: tabId },
    ),
    writeClientAppState(
      tabScopedGenerationContextKey(tabId),
      scopedLibraryContext(context),
      {
        requestSource: tabId,
      },
    ),
  ]);
  return context;
}

export function setAssetsGenerationChatContext({
  context,
  libraryTitle,
  presetTitle,
  openSidebar = false,
}: {
  context: GenerationContext;
  libraryTitle?: string | null;
  presetTitle?: string | null;
  openSidebar?: boolean;
}) {
  setAgentChatContextItem({
    key: GENERATION_CONTEXT_CHAT_KEY,
    title: "Assets Generation Context",
    context: generationContextPromptBlock({
      context,
      libraryTitle,
      presetTitle,
    }),
    openSidebar,
  });
}

export function useGenerationContext() {
  return useQuery({
    queryKey: generationContextQueryKey(),
    queryFn: async ({ signal }) => readClientGenerationContext({ signal }),
    staleTime: 2_000,
  });
}

export function useGenerationContextWriter(context: GenerationContext) {
  const queryClient = useQueryClient();
  return useCallback(
    async (patch: Partial<GenerationContext>) => {
      const next = normalizeGenerationContext({ ...context, ...patch });
      queryClient.setQueryData(generationContextQueryKey(), next);
      await writeClientGenerationContext(next);
      void queryClient.invalidateQueries({ queryKey: ["app-state"] });
      return next;
    },
    [context, queryClient],
  );
}

export function useGenerationContextSync(activeLibraryId?: string | null) {
  const contextQuery = useGenerationContext();
  const context = contextQuery.data ?? normalizeGenerationContext(null);
  const writeContext = useGenerationContextWriter(context);
  const { data: librariesData } = useActionQuery("list-libraries", {
    compact: true,
  } as any) as { data?: LibraryListResult };
  const { data: presetData } = useActionQuery(
    "list-generation-presets",
    { libraryId: context.libraryId } as any,
    { enabled: Boolean(context.libraryId) } as any,
  ) as { data?: PresetListResult };
  const libraries = librariesData?.libraries ?? [];
  const presets = useMemo(
    () => presetData?.presets ?? [],
    [presetData?.presets],
  );
  const selectedLibrary = libraries.find(
    (library) => library.id === context.libraryId,
  );
  const selectedPreset =
    presets.find((preset) => preset.id === context.presetId) ?? null;

  useEffect(() => {
    if (!activeLibraryId) return;
    if (context.libraryId === activeLibraryId) return;
    void writeContext({ libraryId: activeLibraryId, presetId: null });
  }, [activeLibraryId, context.libraryId, writeContext]);

  useEffect(() => {
    if (!context.presetId) return;
    if (!context.libraryId) {
      void writeContext({ presetId: null });
      return;
    }
    if (!presetData?.presets) return;
    const presetBelongsToLibrary = presetData.presets.some(
      (preset) => preset.id === context.presetId,
    );
    if (!presetBelongsToLibrary) {
      void writeContext({ presetId: null });
    }
  }, [context.libraryId, context.presetId, presetData?.presets, writeContext]);

  useEffect(() => {
    setAssetsGenerationChatContext({
      context,
      libraryTitle: selectedLibrary?.title,
      presetTitle: selectedPreset?.title,
    });
  }, [context, selectedLibrary?.title, selectedPreset?.title]);
}
