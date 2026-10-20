import { NATIVE_EFFECT_BUILTIN_VERSIONS } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import type { EffectDefinition, EffectInstance } from "@shared/native-effects";
import { IconAlertTriangle } from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  nativeCatalogPreviewKey,
  renderNativeCatalogPreviews,
} from "./native-shader-catalog-preview";

type Preview =
  | { status: "ready"; url: string }
  | { status: "error"; code: string };
const PreviewContext = createContext<ReadonlyMap<string, Preview>>(new Map());

export function NativeShaderCatalogPreviewProvider({
  definitions,
  placement,
  children,
  approvedDefinitionHashes,
}: {
  approvedDefinitionHashes?: readonly string[] | null;
  definitions: readonly EffectDefinition[];
  placement: EffectInstance["placement"];
  children: ReactNode;
}) {
  const cache = useRef(new Map<string, Preview>());
  const [previews, setPreviews] = useState<ReadonlyMap<string, Preview>>(
    new Map(),
  );
  const approvalRevision =
    approvedDefinitionHashes === undefined
      ? "pending"
      : approvedDefinitionHashes === null
        ? "unreadable"
        : JSON.stringify([...approvedDefinitionHashes].sort());
  useEffect(() => {
    const controller = new AbortController();
    const custom = (definition: EffectDefinition) =>
      !NATIVE_EFFECT_BUILTIN_VERSIONS.some(
        (builtin) => builtin.id === definition.id,
      );
    const cacheKey = (definition: EffectDefinition) =>
      `${placement}:${nativeCatalogPreviewKey(definition)}:${custom(definition) ? approvalRevision : "builtin"}`;
    const activeKeys = new Set(definitions.map(cacheKey));
    for (const [key, preview] of cache.current) {
      if (activeKeys.has(key)) continue;
      if (preview.status === "ready") URL.revokeObjectURL(preview.url);
      cache.current.delete(key);
    }
    const current = () =>
      new Map(
        definitions.flatMap((definition) => {
          const preview = cache.current.get(cacheKey(definition));
          return preview
            ? [[nativeCatalogPreviewKey(definition), preview] as const]
            : [];
        }),
      );
    setPreviews(current());
    const missing = definitions.filter(
      (definition) => !cache.current.has(cacheKey(definition)),
    );
    if (missing.length) {
      let attempted: readonly EffectDefinition[] = missing;
      void Promise.all(
        missing.map(async (definition) => {
          if (!custom(definition)) return definition;
          if (approvedDefinitionHashes === undefined) return null;
          const code =
            approvedDefinitionHashes === null
              ? "native-catalog-preview-approvals-unreadable"
              : approvedDefinitionHashes.includes(
                    await hashEffectDefinition(definition),
                  )
                ? null
                : "native-catalog-preview-definition-unapproved";
          if (controller.signal.aborted) return null;
          if (code) {
            cache.current.set(cacheKey(definition), { status: "error", code });
            return null;
          }
          return definition;
        }),
      )
        .then((eligible) => {
          if (controller.signal.aborted) return new Map<string, Blob>();
          attempted = eligible.filter(
            (definition): definition is EffectDefinition => definition !== null,
          );
          setPreviews(current());
          return attempted.length
            ? renderNativeCatalogPreviews(
                attempted,
                placement,
                controller.signal,
                approvedDefinitionHashes ?? [],
              )
            : new Map<string, Blob>();
        })
        .then((results) => {
          if (controller.signal.aborted) return;
          const blobs = attempted.map((definition) => {
            const blob = results.get(nativeCatalogPreviewKey(definition));
            if (!blob) throw new Error("native-catalog-preview-result-missing");
            return { definition, blob };
          });
          const created: { definition: EffectDefinition; url: string }[] = [];
          try {
            for (const { definition, blob } of blobs)
              created.push({ definition, url: URL.createObjectURL(blob) });
          } catch (error) {
            for (const { url } of created) URL.revokeObjectURL(url);
            throw error;
          }
          for (const { definition, url } of created)
            cache.current.set(cacheKey(definition), { status: "ready", url });
          setPreviews(current());
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("Native catalog preview failed", error);
          const code =
            error instanceof Error
              ? error.message
              : "native-catalog-preview-failed";
          for (const definition of attempted)
            cache.current.set(cacheKey(definition), { status: "error", code });
          setPreviews(current());
        });
    }
    return () => controller.abort();
  }, [definitions, placement, approvalRevision]);
  useEffect(
    () => () => {
      for (const preview of cache.current.values())
        if (preview.status === "ready") URL.revokeObjectURL(preview.url);
      cache.current.clear();
    },
    [],
  );
  return (
    <PreviewContext.Provider value={previews}>
      {children}
    </PreviewContext.Provider>
  );
}

export function NativeShaderCatalogPreview({
  definition,
  className,
}: {
  definition: EffectDefinition;
  className?: string;
}) {
  const preview = useContext(PreviewContext).get(
    nativeCatalogPreviewKey(definition),
  );
  return (
    <div
      aria-hidden="true"
      data-native-shader-preview={nativeCatalogPreviewKey(definition)}
      data-native-shader-preview-status={preview?.status ?? "pending"}
      className={cn("relative overflow-hidden bg-muted", className)}
    >
      {preview?.status === "ready" ? (
        <img src={preview.url} alt="" className="size-full object-cover" />
      ) : preview?.status === "error" ? (
        <div
          className="flex size-full items-center justify-center text-muted-foreground"
          data-native-shader-preview-error={preview.code}
        >
          <IconAlertTriangle className="size-4" />
        </div>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
    </div>
  );
}
