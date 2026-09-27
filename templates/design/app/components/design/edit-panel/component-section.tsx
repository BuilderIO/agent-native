import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
} from "@agent-native/core/client/settings";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "@shared/code-layer";
import {
  COMPONENT_ARCHIVE_ATTR,
  readComponentArchivePointer,
} from "@shared/component-archive";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  componentNodeIdMatches,
  propNameToDataAttribute,
} from "@shared/component-model";
import {
  IconArrowRight,
  IconArrowsLeftRight,
  IconCode,
  IconComponents,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
  IconUnlink,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import type { LocalhostWriteConsentPayload } from "../LocalhostWriteConsentDialog";
import { findCanvasIframeForScreen } from "../multi-screen/iframe-targeting";
import {
  canRebuildAlpineDataLosslessly,
  isBooleanPropValue,
  parseAlpineDataObject,
  replaceAlpineDataKeyValue,
  serializeAlpineDataObject,
} from "./code-inspect-helpers";
import {
  InspectorActionRail,
  InspectorGrid,
  InspectorGridCell,
} from "./inspector-grid";

function isLocalhostWriteConsentError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "LocalWriteConsentRequiredError" ||
      error.name === "WriteConsentRequiredError" ||
      /write-consent grant|grant expired/i.test(error.message))
  );
}

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
  designId: string;
  featureLabel: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isLoading } = useActionQuery<ConnectBuilderAppResult>(
    "connect-builder-app",
    { designId },
  );
  const builderConnect = useBuilderConnectFlow({
    popupUrl:
      data?.cta?.kind === "connect-builder" ? data.cta.connectUrl : undefined,
    provisionAccount: true,
    trackingSource: "design_editor_make_real",
    trackingFlow: "design_migration",
    onConnected: () => {
      if (data?.cta?.kind === "connect-builder") {
        void queryClient.invalidateQueries({
          queryKey: ["action", "connect-builder-app", { designId }],
        });
      }
    },
  });

  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  if (isLoading || !data) {
    return (
      <div className="flex h-7 items-center rounded-[5px] bg-[var(--design-editor-control-bg)] px-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }

  const cta = data.cta;

  if (!cta) return null;

  const isPending = migrateMutation.isPending;
  const migrateError = migrateMutation.error;

  const handlePrimary = () => {
    if (cta.kind === "configure-project") {
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
  };

  const handleMigrate = () => {
    migrateMutation.mutate({ designId });
  };

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
        <p className="design-sidebar-field-label min-w-0 flex-1 truncate text-muted-foreground">
          {migrateResult.message ??
            `Generating ${migrateResult.branchName ?? "React app"}.`}
        </p>
        <a
          href={withBuilderUtmTrackingParams(migrateResult.url, {
            campaign: "product",
            content: "design_migration",
          })}
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
      : `Connect Builder (free tier available) to enable ${featureLabel}.`;
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
          className="design-sidebar-field-label min-w-0 flex-1 truncate text-muted-foreground"
          title={summary}
        >
          {summary}
        </p>
        {cta.kind === "connect-builder" ? (
          <BuilderConnectPopover flow={builderConnect}>
            <Button
              type="button"
              size="sm"
              title={cta.primaryAction}
              className="h-6 shrink-0 gap-1 rounded-md bg-[var(--design-editor-accent-color)] px-1.5 text-[10px] font-semibold text-primary-foreground hover:bg-[var(--design-editor-accent-hover-color)]"
            >
              {primaryLabel}
              <IconArrowRight className="size-2.5" />
            </Button>
          </BuilderConnectPopover>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handlePrimary}
            title={cta.primaryAction}
            className="h-6 shrink-0 gap-1 rounded-md bg-[var(--design-editor-accent-color)] px-1.5 text-[10px] font-semibold text-primary-foreground hover:bg-[var(--design-editor-accent-hover-color)]"
          >
            {primaryLabel}
            <IconArrowRight className="size-2.5" />
          </Button>
        )}

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

interface ComponentDetailsResult {
  nodeId: string;
  name: string;
  sourceType: string;
  isMain?: boolean;
  canRestore?: boolean;
  observedProps: Array<{ name: string; value: string }>;
  literalProps?: Array<{ name: string; value: string }>;
  persistedVariants: Record<string, string[]>;
  sourceLocation?: { filePath: string; exportName?: string } | null;
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

export interface ComponentLocalSource {
  connectionId: string;
  path: string;
  line: number;
  column: number;
  positionPrecision?: "authored" | "transformed" | "unknown";
  runtimeMultiplicity?: number;
  scope?:
    | "single-instance"
    | "repeated-render"
    | "shared-component-definition"
    | "unknown";
  expectedVersionHash?: string;
  expectedValue?: string;
  propStamps?: Array<{ name: string; value: string }>;
}

export interface RuntimeComponentDetails {
  name: string;
  nodeId: string;
  selector: string;
  props: Array<{ name: string; value: string }>;
  literalProps?: Array<{ name: string; value: string }>;
  alpineData?: string | null;
  componentId?: string;
  componentRef?: string;
  isMain?: boolean;
  sourceLocation?: { filePath: string; exportName?: string };
  local?: ComponentLocalSource;
}

interface GoToMainComponentResult {
  isMain?: boolean;
  ctaRequired?: boolean;
  ctaMessage?: string;
  note?: string;
}

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

export type PropRow = {
  name: string;
  value: string;
  literalValue?: string;
  options?: string[];
  surface: "alpineData" | "attribute";
};

export function componentInstanceHasLocalOverrides(
  projection: CodeLayerProjection,
  root: CodeLayerNode | null | undefined,
): boolean {
  if (
    !root?.dataAttributes[COMPONENT_REF_ATTR] ||
    root.dataAttributes[COMPONENT_ID_ATTR]
  ) {
    return false;
  }
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  return projection.nodes.some((node) => {
    const raw = node.dataAttributes[COMPONENT_OVERRIDES_ATTR];
    if (typeof raw !== "string" || !raw.trim()) return false;
    let current: CodeLayerNode | undefined = node;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.id === root.id) {
        try {
          const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
          return !Array.isArray(parsed) || parsed.length > 0;
        } catch {
          return true;
        }
      }
      visited.add(current.id);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return false;
  });
}

export function buildComponentPropRows(data: {
  instance?: { alpineData?: string | null } | null;
  observedProps: Array<{ name: string; value: string }>;
  persistedVariants: Record<string, string[]>;
  literalProps?: Array<{ name: string; value: string }>;
}): PropRow[] {
  const {
    observedProps,
    persistedVariants,
    instance,
    literalProps = [],
  } = data;
  const alpineData = parseAlpineDataObject(instance?.alpineData);
  const literalValues = new Map(
    literalProps.map(({ name, value }) => [name, value]),
  );

  const rows: PropRow[] = [];
  const seen = new Set<string>();

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

  for (const prop of observedProps) {
    if (seen.has(prop.name)) continue;
    rows.push({
      name: prop.name,
      value: prop.value,
      ...(literalValues.has(prop.name)
        ? { literalValue: literalValues.get(prop.name) }
        : {}),
      options: persistedVariants[prop.name],
      surface: "attribute",
    });
    seen.add(prop.name);
  }

  for (const prop of literalProps) {
    if (seen.has(prop.name)) continue;
    rows.push({
      name: prop.name,
      value: prop.value,
      literalValue: prop.value,
      options: persistedVariants[prop.name],
      surface: "attribute",
    });
    seen.add(prop.name);
  }

  for (const [group, options] of Object.entries(persistedVariants)) {
    if (seen.has(group)) continue;
    rows.push({
      name: group,
      value: literalValues.get(group) ?? options[0] ?? "",
      ...(literalValues.has(group)
        ? { literalValue: literalValues.get(group) }
        : {}),
      options,
      surface: "attribute",
    });
    seen.add(group);
  }

  return rows;
}

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

export function ComponentSection({
  designId,
  fileId,
  boardFileId,
  previewFrameId,
  activeContent,
  activeFileUpdatedAt,
  getExpectedFiles,
  componentDetailsReady = true,
  nodeId,
  swapPickerRequest = 0,
  hasLocalOverrides = false,
  onResetOverrides,
  onRestoreComponent,
  onComponentPropApplied,
  sourceCapabilities = [],
  runtime,
  requestLocalhostWrite,
}: {
  designId: string;
  fileId?: string;
  boardFileId?: string;
  previewFrameId?: string;
  activeContent?: string;
  activeFileUpdatedAt?: string | null;
  getExpectedFiles?: () => Array<{ fileId: string; versionHash: string }>;
  componentDetailsReady?: boolean;
  nodeId: string;
  swapPickerRequest?: number;
  hasLocalOverrides?: boolean;
  onResetOverrides?: () => void;
  onRestoreComponent?: () => void;
  onComponentPropApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
  ) => void;
  sourceCapabilities?: string[];
  runtime?: RuntimeComponentDetails;
  requestLocalhostWrite?: (opts: {
    files: string[];
    onGranted: LocalhostWriteConsentPayload["onGranted"];
    onCancel?: () => void;
  }) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [runtimePropOverride, setRuntimePropOverride] = useState<Array<{
    name: string;
    value: string;
  }> | null>(null);
  const effectiveRuntime = runtime
    ? {
        ...runtime,
        props: runtimePropOverride ?? runtime.props,
      }
    : undefined;
  const propPreviewStateRef = useRef(
    new Map<string, { generation: number; authoritativeValue: string }>(),
  );
  useEffect(() => {
    setRuntimePropOverride(null);
    propPreviewStateRef.current.clear();
  }, [nodeId, runtime?.nodeId, runtime?.props]);
  const detailsParams = {
    designId,
    nodeId,
    ...(fileId ? { fileId } : {}),
    ...(effectiveRuntime ? { runtime: effectiveRuntime } : {}),
  };
  const detailsKey = ["action", "get-component-details", detailsParams];
  const latestSourceRef = useRef<{
    content: string;
    revision?: string | null;
  }>({
    content: activeContent ?? "",
    revision: activeFileUpdatedAt ?? null,
  });
  const componentDetailsReadyRef = useRef(componentDetailsReady);
  componentDetailsReadyRef.current = componentDetailsReady;

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
      { refetchOnMount: "always", enabled: componentDetailsReady },
    );
  const sourceRestoreState = useMemo<
    "unreadable" | "absent" | "invalid" | "valid"
  >(() => {
    if (typeof activeContent !== "string") return "unreadable";
    try {
      const node = buildCodeLayerProjection(activeContent, {
        source: {
          kind: "design-file",
          designId,
          ...(fileId ? { fileId } : {}),
        },
      }).nodes.find((candidate) => componentNodeIdMatches(candidate, nodeId));
      if (!node) return "absent";
      const componentRef = node.dataAttributes[COMPONENT_REF_ATTR]?.trim();
      if (!componentRef) return "absent";
      const archive = readComponentArchivePointer(
        node.dataAttributes[COMPONENT_ARCHIVE_ATTR],
      );
      if (archive.status === "absent") return "absent";
      if (archive.status === "invalid") return "invalid";
      return archive.pointer.componentId === componentRef ? "valid" : "invalid";
    } catch {
      return "unreadable";
    }
  }, [activeContent, designId, fileId, nodeId]);

  const openSourceMutation = useActionMutation("open-component-source");
  const applyPropMutation = useActionMutation("apply-component-prop-edit");
  const goToMainMutation = useActionMutation("go-to-main-component");
  const detachMutation = useActionMutation("detach-component-instance");
  const swapMutation = useActionMutation("swap-component-instance");

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
  };

  const sourceForMutation = () => {
    if (effectiveRuntime?.local) return undefined;
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

      const targetFrameId = previewFrameId ?? fileId;
      if (!targetFrameId) return;
      const iframe = findCanvasIframeForScreen(
        document.body,
        targetFrameId,
        boardFileId,
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
    [
      data?.instance?.nodeId,
      data?.instance?.selector,
      boardFileId,
      fileId,
      nodeId,
      previewFrameId,
    ],
  );

  const updateLocalSourceCache = (content: unknown, versionHash: unknown) => {
    if (
      !effectiveRuntime?.local ||
      (typeof content !== "string" && typeof versionHash !== "string")
    )
      return;
    queryClient.setQueryData(
      [
        "action",
        "read-local-file",
        {
          designId,
          connectionId: effectiveRuntime.local.connectionId,
          path: effectiveRuntime.local.path,
        },
      ],
      (previous: { content?: string; versionHash?: string } | undefined) => ({
        ...previous,
        ...(typeof content === "string" ? { content } : {}),
        ...(typeof versionHash === "string" ? { versionHash } : {}),
      }),
    );
  };

  const updateRuntimeProp = (propName: string | undefined, value: string) => {
    if (!effectiveRuntime || !propName) return;
    setRuntimePropOverride((previous) => {
      const props = previous ?? effectiveRuntime.props;
      const index = props.findIndex((prop) => prop.name === propName);
      if (index === -1) return [...props, { name: propName, value }];
      return props.map((prop, propIndex) =>
        propIndex === index ? { ...prop, value } : prop,
      );
    });
  };

  const persistPropEdit = (
    edit:
      | { kind: "alpineData"; value: string }
      | {
          kind: "attribute";
          attribute: string;
          value: string;
          expectedValue?: string;
          previewValue?: string;
          propName?: string;
        },
  ) => {
    const previousPreviewValue =
      edit.kind === "attribute"
        ? (edit.previewValue ?? edit.expectedValue ?? "")
        : undefined;
    const previewGeneration =
      edit.kind === "attribute"
        ? (propPreviewStateRef.current.get(edit.attribute)?.generation ?? 0) + 1
        : undefined;
    if (edit.kind === "attribute") {
      const previous = propPreviewStateRef.current.get(edit.attribute);
      propPreviewStateRef.current.set(edit.attribute, {
        generation: previewGeneration!,
        authoritativeValue:
          previous?.authoritativeValue ?? previousPreviewValue!,
      });
    }
    const rollbackPreview = () => {
      if (edit.kind !== "attribute") return;
      const current = propPreviewStateRef.current.get(edit.attribute);
      if (!current || current.generation !== previewGeneration) return;
      postComponentPropPreview(edit.attribute, current.authoritativeValue);
    };
    if (edit.kind === "attribute") {
      postComponentPropPreview(edit.attribute, edit.value);
    }
    const latestSource = latestSourceRef.current;
    const mutationSource = effectiveRuntime?.local
      ? {
          local: {
            ...effectiveRuntime.local,
            ...(edit.kind === "attribute" && edit.expectedValue !== undefined
              ? { expectedValue: edit.expectedValue }
              : {}),
          },
        }
      : latestSource.content
        ? {
            currentContent: latestSource.content,
            ...(latestSource.revision
              ? { revision: latestSource.revision }
              : {}),
            ...(getExpectedFiles ? { expectedFiles: getExpectedFiles() } : {}),
          }
        : undefined;
    const payload = {
      designId,
      nodeId,
      ...(fileId ? { fileId } : {}),
      edit:
        edit.kind === "attribute"
          ? {
              kind: "attribute" as const,
              attribute: edit.attribute,
              value: edit.value,
            }
          : edit,
      ...(mutationSource ? { source: mutationSource } : {}),
    };
    const submit = (retriedAfterConsent = false) => {
      applyPropMutation.mutate(payload, {
        onSuccess: (result) => {
          const response = result as {
            content?: unknown;
            fileId?: unknown;
            updatedAt?: unknown;
            conflict?: unknown;
            ctaRequired?: unknown;
            persisted?: unknown;
            error?: unknown;
            source?: {
              connectionId?: unknown;
              path?: unknown;
              versionHash?: unknown;
            };
            result?: { status?: unknown; message?: unknown };
          };
          const resultStatus = response.result?.status;
          updateLocalSourceCache(
            response.content,
            response.source?.versionHash,
          );
          if (
            response.conflict ||
            response.ctaRequired ||
            response.persisted === false ||
            (typeof resultStatus === "string" && resultStatus !== "applied")
          ) {
            rollbackPreview();
            toast.error(
              typeof response.error === "string"
                ? response.error
                : t("designEditor.toasts.componentCreateFailed"),
            );
            return;
          }
          if (edit.kind === "attribute") {
            const current = propPreviewStateRef.current.get(edit.attribute);
            if (current) {
              propPreviewStateRef.current.set(edit.attribute, {
                ...current,
                authoritativeValue: edit.value,
              });
            }
            updateRuntimeProp(edit.propName, edit.value);
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
        onError: (error: unknown) => {
          if (
            !retriedAfterConsent &&
            effectiveRuntime?.local &&
            requestLocalhostWrite &&
            isLocalhostWriteConsentError(error)
          ) {
            requestLocalhostWrite({
              files: [effectiveRuntime.local.path],
              onGranted: () => submit(true),
              onCancel: rollbackPreview,
            });
            return;
          }
          rollbackPreview();
          toast.error(
            error instanceof Error
              ? error.message
              : t("designEditor.toasts.componentCreateFailed"),
          );
        },
        onSettled: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          void queryClient.invalidateQueries({ queryKey: detailsKey });
        },
      });
    };
    submit();
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
      if (componentDetailsReadyRef.current) void refetch();
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [refetch]);

  if (isLoading || !componentDetailsReady) {
    return (
      <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
        <div className="flex min-h-[var(--design-section-height)] items-center gap-2 px-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        </div>
        <div className="design-sidebar-section-content pt-0">
          <div className="h-5 w-full animate-pulse rounded bg-muted/40" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted/40" />
        </div>
      </section>
    );
  }

  if (error || !data) return null;

  const {
    name,
    sourceType,
    sourceLocation,
    observedProps,
    persistedVariants,
    instance,
    capabilities,
    canRestore: serverCanRestore,
  } = data;
  const canRestore =
    sourceRestoreState === "unreadable"
      ? serverCanRestore
      : sourceRestoreState === "valid";

  const isInline = sourceType === "inline";
  const editingEnabled =
    (isInline || Boolean(effectiveRuntime?.local)) && capabilities.canEditProps;
  const alpineData = parseAlpineDataObject(instance?.alpineData);

  const rows: PropRow[] = buildComponentPropRows({
    instance,
    observedProps,
    persistedVariants,
    literalProps: data.literalProps ?? effectiveRuntime?.literalProps,
  });

  const hasRows = rows.length > 0;

  const commitProp = (row: PropRow, nextValue: string) => {
    if (!editingEnabled || nextValue === row.value) return;

    if (row.surface === "alpineData") {
      const original = instance?.alpineData ?? "";
      const surgical = replaceAlpineDataKeyValue(original, row.name, nextValue);

      let serialized: string;
      if (surgical != null) {
        serialized = surgical;
      } else if (canRebuildAlpineDataLosslessly(original)) {
        const nextData = { ...(alpineData ?? {}), [row.name]: nextValue };
        serialized = serializeAlpineDataObject(nextData);
      } else {
        toast.error(t("designEditor.componentProps.alpineTooComplexToEdit"));
        return;
      }

      const nextSerialized = serialized;
      persistPropEdit({ kind: "alpineData", value: nextSerialized });
    } else {
      persistPropEdit({
        kind: "attribute",
        attribute: propNameToDataAttribute(row.name),
        value: nextValue,
        expectedValue: row.literalValue,
        previewValue: row.value,
        propName: row.name,
      });
    }
  };

  const canJumpToSource =
    capabilities.canResolveToFile &&
    Boolean(sourceLocation?.filePath) &&
    sourceCapabilities.includes("resolveNodeToFile");

  const sourceChip = sourceLocation?.exportName
    ? `${sourceLocation.exportName} — ${sourceLocation.filePath}`
    : (sourceLocation?.filePath ?? null);

  return (
    <section
      className="design-sidebar-section shrink-0"
      data-testid="component-section"
    >
      {/* ── Section header ── */}
      <div className="px-2">
        <InspectorGrid
          className="min-h-[var(--design-section-height)] items-center"
          layout="header-actions"
        >
          <InspectorGridCell span={20}>
            <div className="flex min-w-0 items-center gap-2">
              {/* Accent diamond matching the workbench artboard component rows */}
              <span
                className="size-2 shrink-0 rotate-45 rounded-[2px] bg-[var(--design-editor-component-color)]"
                aria-hidden="true"
              />
              <h3 className="design-sidebar-section-title min-w-0 flex-1 truncate text-foreground">
                {name}
              </h3>
            </div>
          </InspectorGridCell>
          <InspectorGridCell span={8}>
            <InspectorActionRail>
              {/* Instance operations: Go to main component / Swap instance /
            Detach instance (Figma's instance-only affordances). Inline/Alpine
            designs only — the underlying actions fail closed for real-app
            sources, so hide them entirely there rather than show a
            perpetually-disabled button. */}
              {isInline && !data.isMain && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={
                          canRestore
                            ? !onRestoreComponent
                            : goToMainMutation.isPending
                        }
                        aria-label={t(
                          canRestore
                            ? "designEditor.componentInstances.restore"
                            : "designEditor.componentInstances.goToMain",
                        )}
                        onClick={
                          canRestore
                            ? onRestoreComponent
                            : handleGoToMainComponent
                        }
                      >
                        {canRestore ? (
                          <IconRefresh className="size-3.5" />
                        ) : (
                          <IconComponents className="size-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t(
                        canRestore
                          ? "designEditor.componentInstances.restore"
                          : "designEditor.componentInstances.goToMain",
                      )}
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
                            aria-label={t(
                              "designEditor.componentInstances.swap",
                            )}
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
                            {t(
                              "designEditor.componentInstances.noOtherComponents",
                            )}
                          </div>
                        ) : (
                          swapCandidates.map((candidate) => (
                            <button
                              key={candidate.name}
                              type="button"
                              disabled={swapMutation.isPending}
                              onClick={() => handleSwapInstance(candidate.name)}
                              className="flex w-full items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-left hover:bg-[var(--design-editor-selection-color)] hover:text-primary-foreground disabled:cursor-wait disabled:opacity-60"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {candidate.name}
                              </span>
                              <span className="design-sidebar-field-label shrink-0 text-muted-foreground">
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
                  {hasLocalOverrides && onResetOverrides ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={
                            !editingEnabled || applyPropMutation.isPending
                          }
                          aria-label={t(
                            "editPanel.interactionStates.resetOverride",
                          )}
                          onClick={onResetOverrides}
                        >
                          <IconRefresh className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("editPanel.interactionStates.resetOverride")}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
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
            </InspectorActionRail>
          </InspectorGridCell>
        </InspectorGrid>
      </div>

      {/* ── Body ── */}
      <div className="design-sidebar-section-content !text-[11px]">
        {/* Source path chip */}
        {sourceChip && (
          <div
            className="flex items-center gap-1 rounded bg-[var(--design-editor-control-bg)] px-2 py-1"
            title={sourceChip}
          >
            <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="design-sidebar-field-label min-w-0 flex-1 truncate font-mono text-muted-foreground">
              {sourceChip}
            </span>
          </div>
        )}

        {/* Typed prop controls. Inline/Alpine designs are editable and persist
            through apply-component-prop-edit; real-app sources are read-only
            until the deeper source-prop controls land. */}
        {hasRows && (
          <div className="design-sidebar-control-stack">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {t("designEditor.componentProps.label")}
            </p>
            {rows.map((row) => {
              const hasOptions = (row.options?.length ?? 0) > 0;
              const isBoolean = !hasOptions && isBooleanPropValue(row.value);
              const disabled = !editingEnabled || applyPropMutation.isPending;
              return (
                <InspectorGrid key={row.name} className="items-center">
                  <InspectorGridCell span={8}>
                    <Label className="design-sidebar-field-label min-w-0 truncate capitalize text-muted-foreground">
                      {row.name}
                    </Label>
                  </InspectorGridCell>
                  <InspectorGridCell span={20}>
                    {hasOptions ? (
                      <Select
                        value={row.value || row.options![0] || ""}
                        onValueChange={(v) => commitProp(row, v)}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
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
                      <div className="flex min-w-0 items-center">
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
                        className="h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] md:!text-[11px]"
                      />
                    )}
                  </InspectorGridCell>
                </InspectorGrid>
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
