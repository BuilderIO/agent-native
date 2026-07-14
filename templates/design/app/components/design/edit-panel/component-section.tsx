import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { propNameToDataAttribute } from "@shared/component-model";
import {
  IconArrowRight,
  IconArrowsLeftRight,
  IconCode,
  IconComponents,
  IconExternalLink,
  IconLoader2,
  IconUnlink,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  canRebuildAlpineDataLosslessly,
  isBooleanPropValue,
  parseAlpineDataObject,
  replaceAlpineDataKeyValue,
  serializeAlpineDataObject,
} from "./code-inspect-helpers";

// ─── Make it real — inline upgrade card (§3, §6.6) ──────────────────────────

/**
 * Payload shape returned by `connect-builder-app`.  Only the fields used by
 * the card UI are typed here; the action may return additional fields.
 */
interface ConnectBuilderAppResult {
  connected: boolean;
  builderEnabled: boolean;
  connectUrl: string;
  appHost: string;
  branchProjectId?: string;
  cta: {
    kind: "connect-builder" | "configure-project";
    label: string;
    description: string;
    primaryAction: string;
    connectUrl: string;
  } | null;
  message: string;
}

/**
 * Inline "Make it real" upgrade card.
 *
 * Rendered wherever a real-app-only control is reached on an inline design
 * (Component source jump, token write-back, live captures, etc.).  Queries
 * `connect-builder-app` to determine the current connection state, then
 * offers the appropriate CTA:
 *
 *   - Not connected → "Connect Builder.io" button (opens connectUrl)
 *   - Connected, no project → "Open Builder settings" (configure project ID)
 *   - Fully enabled → "Make it real" button (calls migrate-inline-design-to-app)
 *
 * The card is progressively disclosed: it only mounts when a gated control is
 * actually reached, so it never appears for users who are already on a real-app
 * source (`localhost` / `fusion`) or whose `sourceCapabilities` already include
 * the needed capability.
 *
 * Matches the design-editor panel chrome: dashed-border, accent tint, small
 * text at 10px — same idiom as the existing `ctaRequired` block in
 * ComponentSection.
 */
function MakeItRealCard({
  designId,
  featureLabel,
}: {
  /** The active design id — required to call connect-builder-app. */
  designId: string;
  /**
   * Short human-readable label for the gated feature (e.g. "token write-back",
   * "component source jump", "live captures"). Shown in the card body so the
   * user understands exactly what they're unlocking.
   */
  featureLabel: string;
}) {
  const t = useT();
  const { data, isLoading } = useActionQuery<ConnectBuilderAppResult>(
    "connect-builder-app",
    { designId },
  );

  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  // While fetching status, show a muted placeholder that matches the card
  // height so the inspector doesn't jump when the data arrives.
  if (isLoading || !data) {
    return (
      <div className="flex h-7 items-center rounded-[5px] bg-[var(--design-editor-control-bg)] px-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }

  // Determine which CTA to show.
  const cta = data.cta;

  // Already fully enabled — no CTA needed (caller should already have gated
  // this component away, but guard here for safety).
  if (!cta) return null;

  const isPending = migrateMutation.isPending;
  const migrateError = migrateMutation.error;

  // "Make it real" primary action: open the connect URL or migrate.
  const handlePrimary = () => {
    if (cta.kind === "connect-builder") {
      // Open the Builder OAuth connect flow in a new tab.  The user completes
      // it there and comes back; the card will re-query on next render.
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (cta.kind === "configure-project") {
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
  };

  const handleMigrate = () => {
    migrateMutation.mutate({ designId });
  };

  // Migration result — show branch link.
  const migrateResult = migrateMutation.data as
    | {
        status: "processing";
        branchName?: string;
        url?: string;
        message?: string;
      }
    | undefined;

  if (migrateResult?.status === "processing" && migrateResult.url) {
    return (
      <div className="flex items-center gap-2 rounded-[5px] border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 py-1.5">
        <IconLoader2 className="size-3.5 shrink-0 animate-spin text-[var(--design-editor-accent-color)]" />
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {migrateResult.message ??
            `Generating ${migrateResult.branchName ?? "React app"}.`}
        </p>
        <a
          href={migrateResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold text-[var(--design-editor-accent-color)] hover:bg-[var(--design-editor-panel-raised-bg)]"
        >
          {t("designEditor.makeItRealCard.open")}
          <IconExternalLink className="size-2.5" />
        </a>
      </div>
    );
  }

  const summary =
    cta.kind === "configure-project"
      ? `Choose a Builder project to enable ${featureLabel}.`
      : `Connect Builder to enable ${featureLabel}.`;
  const primaryLabel =
    cta.kind === "configure-project"
      ? t("designEditor.makeItRealCard.choose")
      : t("designEditor.makeItRealCard.connect");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-[5px] border border-dashed border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]/70 px-2 py-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--design-editor-accent-color)]"
          aria-hidden="true"
        />
        <p
          className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
          title={summary}
        >
          {summary}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handlePrimary}
          title={cta.primaryAction}
          className="h-6 shrink-0 gap-1 rounded-md bg-[var(--design-editor-accent-color)] px-1.5 text-[10px] font-semibold text-white hover:bg-[var(--design-editor-accent-hover-color)]"
        >
          {primaryLabel}
          <IconArrowRight className="size-2.5" />
        </Button>

        {/* When Builder is fully connected, also offer direct migration */}
        {data.connected && data.builderEnabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMigrate}
            disabled={isPending}
            className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? (
              <>
                <IconLoader2 className="size-2.5 animate-spin" />
                {t("designEditor.makeItRealCard.generating")}
              </>
            ) : (
              <>{t("designEditor.makeItRealCard.generate")}</>
            )}
          </Button>
        )}
      </div>
      {migrateError ? (
        <p className="px-2 text-[10px] text-destructive">
          {migrateError instanceof Error
            ? migrateError.message
            : t("designEditor.makeItRealCard.migrationFailed")}
        </p>
      ) : null}
    </div>
  );
}

// ─── Component section (§6.1) ─────────────────────────────────────────────────

/**
 * Shape returned by `get-component-details`.  Only the fields the UI needs are
 * typed here; the action may return additional fields.
 */
interface ComponentDetailsResult {
  nodeId: string;
  name: string;
  sourceType: string;
  observedProps: Array<{ name: string; value: string }>;
  persistedVariants: Record<string, string[]>;
  sourceLocation?: { filePath: string; exportName?: string } | null;
  /** Component instance shape, including the Alpine `x-data` expression. */
  instance?: {
    alpineData?: string | null;
    nodeId?: string;
    selector?: string;
  } | null;
  capabilities: {
    canResolveToFile: boolean;
    hasFullIndex: boolean;
    canEditProps: boolean;
    ctaRequired: boolean;
    ctaMessage?: string;
  };
}

/** Shape returned by `go-to-main-component`. */
interface GoToMainComponentResult {
  isMain?: boolean;
  ctaRequired?: boolean;
  ctaMessage?: string;
  note?: string;
}

/** Shape returned by `swap-component-instance`. */
interface SwapComponentInstanceResult {
  swapped?: boolean;
  conflict?: boolean;
  ctaRequired?: boolean;
  ctaMessage?: string;
  error?: string;
  note?: string;
  fromComponent?: string;
  toComponent?: string;
  fileId?: string;
  content?: string;
  updatedAt?: string;
}

/** Shape returned by `detach-component-instance`. */
interface DetachComponentInstanceResult {
  detached?: boolean;
  conflict?: boolean;
  ctaRequired?: boolean;
  ctaMessage?: string;
  error?: string;
  note?: string;
  fileId?: string;
  content?: string;
  updatedAt?: string;
}

/** Each editable row: name + current value + how it persists + its options. */
export type PropRow = {
  name: string;
  value: string;
  /** Variant/enum options when the prop is a known group. */
  options?: string[];
  /** Persist surface for this prop. */
  surface: "alpineData" | "attribute";
};

/**
 * Build the editable prop rows for a component instance from
 * `get-component-details`'s response: Alpine `x-data` keys first (they drive
 * the live variant/state), then observed `data-agent-native-prop-*`
 * attributes not already covered by x-data, then any persisted variant group
 * that has never been observed on this instance at all (seeded to its first
 * option).
 *
 * Pure — exported for tests.
 */
export function buildComponentPropRows(data: {
  instance?: { alpineData?: string | null } | null;
  observedProps: Array<{ name: string; value: string }>;
  persistedVariants: Record<string, string[]>;
}): PropRow[] {
  const { observedProps, persistedVariants, instance } = data;
  const alpineData = parseAlpineDataObject(instance?.alpineData);

  const rows: PropRow[] = [];
  const seen = new Set<string>();

  // 1) Alpine x-data keys come first — they drive the live variant/state.
  if (alpineData) {
    for (const [key, value] of Object.entries(alpineData)) {
      rows.push({
        name: key,
        value,
        options: persistedVariants[key],
        surface: "alpineData",
      });
      seen.add(key);
    }
  }

  // 2) data-agent-native-prop-* attributes not already covered by x-data.
  for (const prop of observedProps) {
    if (seen.has(prop.name)) continue;
    rows.push({
      name: prop.name,
      value: prop.value,
      options: persistedVariants[prop.name],
      surface: "attribute",
    });
    seen.add(prop.name);
  }

  // 3) persistedVariant groups with no observed value yet (default to first).
  // Surface is always "attribute" here, NOT "alpineData" even when this
  // instance's x-data happens to be non-empty for other keys: x-data blocks
  // for a real component instance are written with every prop the component
  // declares initialized up front (e.g. `{ variant: 'solid', size: 'md' }`),
  // so a group that never showed up in step 1 was never a x-data key on this
  // instance in the first place — it is attribute-driven. Guessing
  // "alpineData" from unrelated sibling keys used to route the very first
  // edit of such a prop into a surgical/rebuild x-data write that either
  // silently wrote a key nothing in the template reads, or hit the "can't
  // safely edit this prop inline" bail-out when the sibling x-data content
  // was too complex to rebuild — even though the plain attribute write would
  // have worked fine.
  for (const [group, options] of Object.entries(persistedVariants)) {
    if (seen.has(group)) continue;
    rows.push({
      name: group,
      value: options[0] ?? "",
      options,
      surface: "attribute",
    });
    seen.add(group);
  }

  return rows;
}

/**
 * True when a "message" event's source window matches one of this document's
 * own embedded design-preview iframes.
 *
 * `postMessage` has no origin/source check built in, so without this any
 * window — including a spoofed one from a compromised/unrelated frame — could
 * post `{ type: "element-select" }` at the parent and force this section to
 * refetch. Mirrors the DOM-identity check DesignCanvas's
 * `isTrustedCanvasBridgeMessage` and MultiScreenCanvas's cross-screen-drag
 * handler use: trust comes from matching `iframe.contentWindow` against
 * `event.source`, not from anything in the message payload.
 *
 * Exported for tests.
 */
export function isMessageFromOwnPreviewIframe(
  source: MessageEventSource | null,
): boolean {
  if (typeof document === "undefined" || !source) return false;
  return Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    ),
  ).some((iframe) => iframe.contentWindow === source);
}

/**
 * Contextual COMPONENT section rendered inside the Design tab when the
 * selected element is a component instance (carries
 * `data-agent-native-component`).
 *
 * Shows: component name, source path (when capability available), observed
 * prop values, variant/size/state controls from `get-component-details`, and
 * an "Edit component source" action.  Real-app features are gated by the
 * capabilities returned by the action; Alpine gets a lightweight read-only
 * view plus a Connect-Builder CTA.
 *
 * Matches the workbench artboard spec in DESIGN-STUDIO-PLAN.md §6.1.
 */
export function ComponentSection({
  designId,
  fileId,
  activeContent,
  activeFileUpdatedAt,
  nodeId,
  swapPickerRequest = 0,
  onComponentPropApplied,
  sourceCapabilities = [],
}: {
  designId: string;
  fileId?: string;
  activeContent?: string;
  activeFileUpdatedAt?: string | null;
  nodeId: string;
  /** Increment to open the Swap instance picker from another UI entry point. */
  swapPickerRequest?: number;
  onComponentPropApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
  /** Capability names advertised by the current source. */
  sourceCapabilities?: string[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const detailsParams = { designId, nodeId, ...(fileId ? { fileId } : {}) };
  const detailsKey = ["action", "get-component-details", detailsParams];
  const latestSourceRef = useRef<{
    content: string;
    revision?: string | null;
  }>({
    content: activeContent ?? "",
    revision: activeFileUpdatedAt ?? null,
  });

  useEffect(() => {
    latestSourceRef.current = {
      content: activeContent ?? "",
      revision: activeFileUpdatedAt ?? null,
    };
  }, [activeContent, activeFileUpdatedAt, fileId, nodeId]);

  const { data, isLoading, error, refetch } =
    useActionQuery<ComponentDetailsResult>(
      "get-component-details",
      detailsParams,
      { refetchOnMount: "always" },
    );

  const openSourceMutation = useActionMutation("open-component-source");
  const applyPropMutation = useActionMutation("apply-component-prop-edit");
  const goToMainMutation = useActionMutation("go-to-main-component");
  const detachMutation = useActionMutation("detach-component-instance");
  const swapMutation = useActionMutation("swap-component-instance");

  // ── Swap instance picker (searchable popover) ─────────────────────────────
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);
  const [swapQuery, setSwapQuery] = useState("");
  useEffect(() => {
    if (swapPickerRequest > 0) setSwapPickerOpen(true);
  }, [swapPickerRequest]);
  const componentName = data?.name;
  const { data: swapCatalog, isLoading: swapCatalogLoading } = useActionQuery(
    "list-design-components",
    { designId, excludeName: componentName },
    { enabled: swapPickerOpen && Boolean(componentName) },
  );
  const swapCandidates = (swapCatalog?.components ?? []).filter((c) =>
    c.name.toLowerCase().includes(swapQuery.trim().toLowerCase()),
  );

  // Refresh the component section + design canvas after a detach/swap
  // mutates the design file, mirroring persistPropEdit's onSettled below.
  // Plain function (not memoized) — matches this file's existing
  // persistPropEdit/commitProp convention of re-creating handlers per render
  // rather than threading useCallback dependency arrays through them.
  const refreshAfterInstanceMutation = (result: {
    fileId?: string;
    content?: string;
    updatedAt?: string;
  }) => {
    if (
      typeof result.fileId === "string" &&
      typeof result.content === "string"
    ) {
      latestSourceRef.current = {
        content: result.content,
        revision: result.updatedAt ?? latestSourceRef.current.revision,
      };
      onComponentPropApplied?.(result.fileId, result.content, result.updatedAt);
    }
    void queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
    void queryClient.invalidateQueries({ queryKey: detailsKey });
    void refetch();
  };

  const sourceForMutation = () => {
    const latestSource = latestSourceRef.current;
    return latestSource.content
      ? {
          currentContent: latestSource.content,
          ...(latestSource.revision ? { revision: latestSource.revision } : {}),
        }
      : undefined;
  };

  const handleGoToMainComponent = () => {
    goToMainMutation.mutate(
      { designId, nodeId, ...(fileId ? { fileId } : {}) },
      {
        onSuccess: (result: GoToMainComponentResult) => {
          if (result.ctaRequired) {
            toast.error(
              result.ctaMessage ??
                t("designEditor.componentInstances.goToMainUnavailable"),
            );
            return;
          }
          if (result.isMain) {
            toast(
              result.note ??
                t("designEditor.componentInstances.onlyKnownInstance"),
            );
          }
        },
        onError: () =>
          toast.error(t("designEditor.componentInstances.resolveMainFailed")),
      },
    );
  };

  const handleDetachInstance = () => {
    const source = sourceForMutation();
    detachMutation.mutate(
      {
        designId,
        nodeId,
        ...(fileId ? { fileId } : {}),
        ...(source ? { source } : {}),
      },
      {
        onSuccess: (result: DetachComponentInstanceResult) => {
          if (result.conflict || result.ctaRequired) {
            toast.error(
              result.error ??
                result.ctaMessage ??
                t("designEditor.componentInstances.detachFailed"),
            );
            return;
          }
          if (result.detached) {
            toast(result.note ?? t("designEditor.componentInstances.detached"));
            refreshAfterInstanceMutation(result);
          }
        },
        onError: () =>
          toast.error(t("designEditor.componentInstances.detachFailed")),
      },
    );
  };

  const handleSwapInstance = (targetComponentName: string) => {
    const source = sourceForMutation();
    swapMutation.mutate(
      {
        designId,
        nodeId,
        ...(fileId ? { fileId } : {}),
        targetComponentName,
        ...(source ? { source } : {}),
      },
      {
        onSuccess: (result: SwapComponentInstanceResult) => {
          if (result.conflict || result.ctaRequired) {
            toast.error(
              result.error ??
                result.ctaMessage ??
                t("designEditor.componentInstances.swapFailed"),
            );
            return;
          }
          if (result.swapped) {
            toast(
              result.note ??
                t("designEditor.componentInstances.swappedFor", {
                  name: targetComponentName,
                }),
            );
            setSwapPickerOpen(false);
            setSwapQuery("");
            refreshAfterInstanceMutation(result);
          }
        },
        onError: () =>
          toast.error(t("designEditor.componentInstances.swapFailed")),
      },
    );
  };

  const postComponentPropPreview = useCallback(
    (attribute: string, value: string) => {
      if (typeof document === "undefined") return;

      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      iframe?.contentWindow?.postMessage(
        {
          type: "style-change",
          selector: data?.instance?.selector ?? "",
          nodeId: data?.instance?.nodeId ?? nodeId,
          attributeOverrides: { [attribute]: value },
        },
        "*",
      );
    },
    [data?.instance?.nodeId, data?.instance?.selector, nodeId],
  );

  // Persist a single prop change through apply-component-prop-edit. Attribute
  // props also preview immediately in the iframe so the selected component
  // changes without waiting for the write/refetch round-trip.
  const persistPropEdit = (
    edit:
      | { kind: "alpineData"; value: string }
      | { kind: "attribute"; attribute: string; value: string },
    optimistic: (prev: ComponentDetailsResult) => ComponentDetailsResult,
  ) => {
    queryClient.setQueryData<ComponentDetailsResult>(detailsKey, (prev) =>
      prev ? optimistic(prev) : prev,
    );
    if (edit.kind === "attribute") {
      postComponentPropPreview(edit.attribute, edit.value);
    }
    const latestSource = latestSourceRef.current;
    applyPropMutation.mutate(
      {
        designId,
        nodeId,
        ...(fileId ? { fileId } : {}),
        edit,
        ...(latestSource.content
          ? {
              source: {
                currentContent: latestSource.content,
                ...(latestSource.revision
                  ? { revision: latestSource.revision }
                  : {}),
              },
            }
          : {}),
      },
      {
        onSuccess: (result) => {
          const response = result as {
            content?: unknown;
            fileId?: unknown;
            updatedAt?: unknown;
            conflict?: unknown;
            error?: unknown;
          };
          if (response.conflict) {
            toast.error(
              typeof response.error === "string"
                ? response.error
                : "This file changed since this component prop edit was prepared. Refresh and try again.",
            );
            return;
          }
          if (
            typeof response.fileId === "string" &&
            typeof response.content === "string"
          ) {
            const updatedAt =
              typeof response.updatedAt === "string"
                ? response.updatedAt
                : undefined;
            latestSourceRef.current = {
              content: response.content,
              revision: updatedAt ?? latestSourceRef.current.revision,
            };
            onComponentPropApplied?.(
              response.fileId,
              response.content,
              updatedAt,
            );
          }
        },
        onSettled: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          void queryClient.invalidateQueries({ queryKey: detailsKey });
          void refetch();
        },
      },
    );
  };

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleMessage = (event: MessageEvent) => {
      if (
        (event.data as { type?: unknown } | null)?.type !== "element-select"
      ) {
        return;
      }
      if (!isMessageFromOwnPreviewIframe(event.source)) return;
      void refetch();
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [refetch]);

  // While loading, show a compact skeleton that matches the section width.
  if (isLoading) {
    return (
      <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
        <div className="flex min-h-9 items-center gap-2 px-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        </div>
        <div className="space-y-1.5 px-3 pb-3 pt-0.5">
          <div className="h-5 w-full animate-pulse rounded bg-muted/40" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted/40" />
        </div>
      </section>
    );
  }

  // Hard error (node not found, no access, etc.) — collapse silently so
  // the rest of the inspector is not disrupted.
  if (error || !data) return null;

  const {
    name,
    sourceType,
    sourceLocation,
    observedProps,
    persistedVariants,
    instance,
    capabilities,
  } = data;

  // ── Editable prop model ───────────────────────────────────────────────────
  // Inline/Alpine designs persist through apply-component-prop-edit. Two write
  // surfaces:
  //   • x-data keys      → kind "alpineData" (rewrites the whole object)
  //   • data-prop-* attrs → kind "attribute"  (data-agent-native-prop-<kebab>)
  // Real-app sources keep the deeper source-prop controls gated as-is, so for
  // non-inline sources the controls are read-only here.
  const isInline = sourceType === "inline";
  const editingEnabled = isInline && capabilities.canEditProps; // gated; real-app stays read-only for now
  const alpineData = parseAlpineDataObject(instance?.alpineData);

  const rows: PropRow[] = buildComponentPropRows({
    instance,
    observedProps,
    persistedVariants,
  });

  const hasRows = rows.length > 0;

  // Build the apply-component-prop-edit payload + optimistic cache patch for a
  // single prop change.
  const commitProp = (row: PropRow, nextValue: string) => {
    if (!editingEnabled || nextValue === row.value) return;

    if (row.surface === "alpineData") {
      // Surgically replace only the edited key's value inside the original
      // x-data string so methods, nested objects, escaped strings, quoted
      // keys, and whitespace survive byte-for-byte. A full
      // parse→mutate→serialize round-trip would drop anything
      // parseAlpineDataObject can't model (e.g. `toggle() { … }`).
      const original = instance?.alpineData ?? "";
      const surgical = replaceAlpineDataKeyValue(original, row.name, nextValue);

      let serialized: string;
      if (surgical != null) {
        serialized = surgical;
      } else if (canRebuildAlpineDataLosslessly(original)) {
        // The key isn't present yet (or there is no original literal). Rebuild
        // from the flat map — safe here precisely because the original holds
        // nothing richer than the flat literals serialize already preserves.
        const nextData = { ...(alpineData ?? {}), [row.name]: nextValue };
        serialized = serializeAlpineDataObject(nextData);
      } else {
        // The original carries content (methods / nested / expressions) we
        // can't rewrite for this key without dropping it. Fail safe: skip the
        // edit rather than persist a lossy rewrite, and tell the user why so
        // the change doesn't silently vanish.
        toast.error(t("designEditor.componentProps.alpineTooComplexToEdit"));
        return;
      }

      const nextSerialized = serialized;
      persistPropEdit(
        { kind: "alpineData", value: nextSerialized },
        (prev) => ({
          ...prev,
          instance: { ...(prev.instance ?? {}), alpineData: nextSerialized },
          observedProps: prev.observedProps.map((p) =>
            p.name === row.name ? { ...p, value: nextValue } : p,
          ),
        }),
      );
    } else {
      persistPropEdit(
        {
          kind: "attribute",
          attribute: propNameToDataAttribute(row.name),
          value: nextValue,
        },
        (prev) => {
          const exists = prev.observedProps.some((p) => p.name === row.name);
          return {
            ...prev,
            observedProps: exists
              ? prev.observedProps.map((p) =>
                  p.name === row.name ? { ...p, value: nextValue } : p,
                )
              : [...prev.observedProps, { name: row.name, value: nextValue }],
          };
        },
      );
    }
  };

  // ── Capability gates ──
  const canJumpToSource =
    capabilities.canResolveToFile &&
    Boolean(sourceLocation?.filePath) &&
    sourceCapabilities.includes("resolveNodeToFile");

  // ── Source chip text ──
  const sourceChip = sourceLocation?.exportName
    ? `${sourceLocation.exportName} — ${sourceLocation.filePath}`
    : (sourceLocation?.filePath ?? null);

  return (
    <section
      className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0"
      data-testid="component-section"
    >
      {/* ── Section header ── */}
      <div className="flex min-h-9 items-center gap-2 px-3">
        {/* Accent diamond matching the workbench artboard component rows */}
        <span
          className="size-2 shrink-0 rotate-45 rounded-[2px] bg-[var(--design-editor-component-color)]"
          aria-hidden="true"
        />
        <h3 className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
          {name}
        </h3>
        {/* Instance operations: Go to main component / Swap instance /
            Detach instance (Figma's instance-only affordances). Inline/Alpine
            designs only — the underlying actions fail closed for real-app
            sources, so hide them entirely there rather than show a
            perpetually-disabled button. */}
        {isInline && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={goToMainMutation.isPending}
                  aria-label={t("designEditor.componentInstances.goToMain")}
                  onClick={handleGoToMainComponent}
                >
                  <IconComponents className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("designEditor.componentInstances.goToMain")}
              </TooltipContent>
            </Tooltip>

            <Popover
              open={swapPickerOpen}
              onOpenChange={(open) => {
                setSwapPickerOpen(open);
                if (!open) setSwapQuery("");
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!editingEnabled || swapMutation.isPending}
                      aria-label={t("designEditor.componentInstances.swap")}
                    >
                      <IconArrowsLeftRight className="size-3.5" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {t("designEditor.componentInstances.swap")}
                </TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                className="w-56 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-1.5 text-[11px]"
              >
                <Input
                  autoFocus
                  value={swapQuery}
                  onChange={(e) => setSwapQuery(e.target.value)}
                  placeholder={t(
                    "designEditor.componentInstances.searchComponents",
                  )}
                  className="mb-1.5 h-7 !text-[11px]"
                />
                <div className="max-h-52 overflow-y-auto">
                  {swapCatalogLoading ? (
                    <div className="px-2 py-1.5 text-muted-foreground">
                      {t("designEditor.componentInstances.loading")}
                    </div>
                  ) : swapCandidates.length === 0 ? (
                    <div className="px-2 py-1.5 text-muted-foreground">
                      {t("designEditor.componentInstances.noOtherComponents")}
                    </div>
                  ) : (
                    swapCandidates.map((candidate) => (
                      <button
                        key={candidate.name}
                        type="button"
                        disabled={swapMutation.isPending}
                        onClick={() => handleSwapInstance(candidate.name)}
                        className="flex w-full items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-left hover:bg-[var(--design-editor-selection-color)] hover:text-white disabled:cursor-wait disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {candidate.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {candidate.instanceCount}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!editingEnabled || detachMutation.isPending}
                  aria-label={t("designEditor.componentInstances.detach")}
                  onClick={handleDetachInstance}
                >
                  <IconUnlink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("designEditor.componentInstances.detach")}
                <span className="ms-1.5 text-muted-foreground/70">
                  {"⌥⌘B" /* i18n-ignore keyboard shortcut */}
                </span>
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {/* Jump-to-source action */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canJumpToSource}
              aria-label={t("designEditor.componentSource.editSource")}
              onClick={() => {
                openSourceMutation.mutate({
                  designId,
                  nodeId,
                  ...(fileId ? { fileId } : {}),
                });
              }}
            >
              <IconExternalLink className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {canJumpToSource
              ? t("designEditor.componentSource.editSource")
              : (capabilities.ctaMessage ??
                t("designEditor.componentSource.needsConnectedApp"))}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ── Body ── */}
      <div className="space-y-1.5 px-3 pb-3 pt-0.5 !text-[11px]">
        {/* Source path chip */}
        {sourceChip && (
          <div
            className="flex items-center gap-1 rounded bg-[var(--design-editor-control-bg)] px-2 py-1"
            title={sourceChip}
          >
            <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {sourceChip}
            </span>
          </div>
        )}

        {/* Typed prop controls. Inline/Alpine designs are editable and persist
            through apply-component-prop-edit; real-app sources are read-only
            until the deeper source-prop controls land. */}
        {hasRows && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {t("designEditor.componentProps.label")}
            </p>
            {rows.map((row) => {
              const hasOptions = (row.options?.length ?? 0) > 0;
              const isBoolean = !hasOptions && isBooleanPropValue(row.value);
              const disabled = !editingEnabled || applyPropMutation.isPending;
              return (
                <div key={row.name} className="flex items-center gap-1.5">
                  <Label className="w-[64px] shrink-0 truncate !text-[11px] font-medium capitalize text-muted-foreground">
                    {row.name}
                  </Label>
                  {hasOptions ? (
                    // Dropdown for variant / enum groups.
                    <Select
                      value={row.value || row.options![0] || ""}
                      onValueChange={(v) => commitProp(row, v)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {row.options!.map((opt) => (
                          <SelectItem
                            key={opt}
                            value={opt}
                            className="!text-[11px]"
                          >
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isBoolean ? (
                    // Toggle for boolean props.
                    <div className="flex min-w-0 flex-1 items-center">
                      <Switch
                        checked={row.value.trim().toLowerCase() === "true"}
                        onCheckedChange={(checked) =>
                          commitProp(row, checked ? "true" : "false")
                        }
                        disabled={disabled}
                        className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
                        aria-label={
                          row.name /* i18n-ignore dynamic prop name */
                        }
                      />
                    </div>
                  ) : (
                    // Text input for string props (e.g. a label).
                    <Input
                      defaultValue={row.value}
                      key={`${row.name}:${row.value}`}
                      disabled={disabled}
                      onBlur={(e) => commitProp(row, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] md:!text-[11px]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Connect-Builder CTA (only when prop editing is actually gated). */}
        {capabilities.ctaRequired && !editingEnabled && (
          <MakeItRealCard
            designId={designId}
            featureLabel="component source jump and typed prop metadata"
          />
        )}
      </div>
    </section>
  );
}
