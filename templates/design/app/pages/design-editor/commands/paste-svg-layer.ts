import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { RefObject } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import { uniqueLayerId } from "@/pages/design-editor/canvas-primitive-insert";
import {
  insertClonedHtmlLayers,
  planLinkedComponentStructureClone,
  queryFirstSelector,
  type ComponentCloneBatchContext,
} from "@/pages/design-editor/clone-and-pen-edit";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import { getOverviewCanvasCenter } from "@/pages/design-editor/commands/pasted-image-files";
import { parsePastedSvg } from "@/pages/design-editor/commands/pasted-svg";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { GeometryHistorySelection } from "@/pages/design-editor/history";
import {
  findScreenFrameAtCanvasPoint,
  getAllScreenFrameEntries,
} from "@/pages/design-editor/overview-camera";
import { resolvePastePlacementForSelection } from "@/pages/design-editor/paste-placement";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLinkedComponentEdit } from "./linked-component-structure";

export interface PastedSvgLayerArgs {
  activeFileId: string | undefined;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: { forcePreviewFullDocument?: boolean },
  ) => ApplyFileContentUpdateResult;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: { forcePreviewFullDocument?: boolean },
  ) => ApplyLocalContentUpdateResult;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  designId: string | undefined;
  files: readonly DesignFile[];
  getFreshActiveContent: () => string;
  getFreshActivePreviewContent: () => string | null;
  getScreenContent: (screenId: string) => string;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => unknown;
  selectedElement: ElementInfo | null | undefined;
  selectedLayerTargets: readonly SelectedLayerTarget[];
  selectionBefore?: GeometryHistorySelection;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
  zoom: number;
}

export function resolvePastedSvgInsertionOptions(args: {
  activeFileId: string;
  baseContent: string;
  point: { x: number; y: number };
  selectedElement: ElementInfo | null | undefined;
  selectedLayerTargets: readonly SelectedLayerTarget[];
  targetFileId: string;
}): NonNullable<Parameters<typeof insertClonedHtmlLayers>[2]> {
  const selectedLayerTarget =
    args.selectedLayerTargets.length === 1
      ? args.selectedLayerTargets[0]
      : undefined;
  const selectedElementForTarget =
    selectedLayerTarget?.fileId === args.targetFileId
      ? selectedLayerTarget.elementInfo
      : args.selectedLayerTargets.length === 0 &&
          args.targetFileId === args.activeFileId
        ? args.selectedElement
        : null;
  const selectedTargetSelectors = selectedElementForTarget
    ? [
        selectedElementForTarget.runtimeSelector,
        selectedElementForTarget.selector,
        selectedLayerTarget?.node.selector,
      ].filter((selector): selector is string => Boolean(selector))
    : [];
  const placement =
    selectedElementForTarget && selectedTargetSelectors.length > 0
      ? resolvePastePlacementForSelection({
          content: args.baseContent,
          selectedElement: selectedElementForTarget,
        })?.placement
      : undefined;

  return placement
    ? {
        targetSelectors: selectedTargetSelectors,
        placement,
        stripRootPosition: true,
      }
    : { positions: [{ ...args.point, space: "visual" }] };
}

export function runPastedSvgLayer(
  args: PastedSvgLayerArgs,
  source: string,
  sourceScreenId?: string,
): boolean {
  const parsed = parsePastedSvg(source);
  if (!parsed || !args.canEditDesign || !args.activeFileId) return false;

  let targetFileId = args.activeFileId;
  let point = { x: 120, y: 120 };
  const pastedIntoScreen =
    sourceScreenId &&
    sourceScreenId !== args.boardFileId &&
    args.files.some((file) => file.id === sourceScreenId);
  if (pastedIntoScreen) {
    targetFileId = sourceScreenId;
    const frame = getAllScreenFrameEntries({
      overviewScreens: args.overviewScreens,
      canvasFrameGeometryById: args.canvasFrameGeometryById,
    }).find((candidate) => candidate.id === sourceScreenId);
    if (frame) {
      point = {
        x: frame.geometry.width / 2,
        y: frame.geometry.height / 2,
      };
    }
  } else if (args.viewModeRef.current === "single") {
    const iframe = args.canvasContainerRef.current?.querySelector<HTMLElement>(
      "[data-design-preview-iframe]",
    );
    const rect = iframe?.getBoundingClientRect();
    const factor = args.zoom / 100;
    point = rect
      ? {
          x: Math.max(0, rect.width / 2 / factor),
          y: Math.max(0, rect.height / 2 / factor),
        }
      : point;
  } else if (args.boardFileId) {
    const frames = getAllScreenFrameEntries({
      overviewScreens: args.overviewScreens,
      canvasFrameGeometryById: args.canvasFrameGeometryById,
    });
    let anchor = (() => {
      if (args.overviewSelectedScreenIds.length === 1) {
        const selected = frames.find(
          (frame) => frame.id === args.overviewSelectedScreenIds[0],
        );
        if (selected) {
          return {
            x: selected.geometry.x + selected.geometry.width / 2,
            y: selected.geometry.y + selected.geometry.height / 2,
          };
        }
      }
      return getOverviewCanvasCenter(args.canvasContainerRef.current);
    })();
    const hitFrame = findScreenFrameAtCanvasPoint(
      anchor,
      frames,
      args.boardFileId,
    );
    targetFileId = hitFrame?.id ?? args.boardFileId;
    if (hitFrame) {
      anchor = {
        x: anchor.x - hitFrame.geometry.x,
        y: anchor.y - hitFrame.geometry.y,
      };
    }
    point = anchor;
  }

  const baseContent =
    targetFileId === args.activeFileId
      ? (args.getFreshActivePreviewContent() ?? args.getFreshActiveContent())
      : args.getScreenContent(targetFileId);
  const nodeId = uniqueLayerId("pasted-svg");
  const svgDocument = new DOMParser().parseFromString(
    parsed.svg,
    "image/svg+xml",
  );
  const root = svgDocument.documentElement;
  root.setAttribute("data-agent-native-node-id", nodeId);
  root.setAttribute("data-agent-native-layer-name", "Pasted SVG");
  root.setAttribute("data-an-primitive", "pasted-svg");
  root.setAttribute(
    "style",
    `${root.getAttribute("style") ?? ""};position:absolute;width:${parsed.width}px;height:${parsed.height}px;`,
  );
  const resolvedInsertionOptions = resolvePastedSvgInsertionOptions({
    activeFileId: args.activeFileId,
    baseContent,
    point,
    selectedElement: args.selectedElement,
    selectedLayerTargets: args.selectedLayerTargets,
    targetFileId,
  });
  const targetExists =
    !resolvedInsertionOptions.targetSelectors?.length ||
    Boolean(
      queryFirstSelector(
        new DOMParser().parseFromString(baseContent, "text/html"),
        resolvedInsertionOptions.targetSelectors,
      ),
    );
  const insertionOptions = targetExists
    ? resolvedInsertionOptions
    : { positions: [{ ...point, space: "visual" as const }] };
  const targetFile = args.files.find((file) => file.id === targetFileId);
  const componentLinks: ComponentCloneBatchContext | undefined = targetFile
    ? {
        sourceFileIds: [undefined],
        targetSource: {
          kind: "design-file",
          ...(args.designId ? { designId: args.designId } : {}),
          fileId: targetFile.id,
          filename: targetFile.filename,
        },
        documents: args.files.map((file) => ({
          source: {
            kind: "design-file" as const,
            ...(args.designId ? { designId: args.designId } : {}),
            fileId: file.id,
            filename: file.filename,
          },
          content:
            file.id === targetFileId
              ? baseContent
              : args.getScreenContent(file.id),
        })),
      }
    : undefined;
  let unsupportedStructure = false;
  const cloneOptions = {
    ...insertionOptions,
    ...(componentLinks ? { componentLinks } : {}),
    onUnsupportedStructure: () => {
      unsupportedStructure = true;
    },
  };
  if (
    args.applyLinkedComponentEdit &&
    (insertionOptions.placement === "inside" ||
      insertionOptions.placement === "after")
  ) {
    const plan = planLinkedComponentStructureClone(
      baseContent,
      [root.outerHTML],
      cloneOptions,
    );
    if (plan) {
      args.applyLinkedComponentEdit(
        targetFileId,
        plan.targetNodeId,
        {
          kind: "structure",
          before: plan.mainBefore,
          after: plan.mainAfter,
          selectionNodeIds: plan.selectionNodeIds,
        },
        args.selectionBefore,
      );
      return true;
    }
  }
  const insertion = insertClonedHtmlLayers(
    baseContent,
    [root.outerHTML],
    cloneOptions,
  );
  if (!insertion) {
    toast.error(
      args.t(
        unsupportedStructure
          ? "designEditor.componentInstances.linkedStructureUnsupported"
          : "designEditor.toasts.primitiveInsertFailed",
      ),
    );
    return true;
  }
  const nextContent = insertion.content;
  let publication: ApplyFileContentUpdateResult | ApplyLocalContentUpdateResult;
  if (targetFileId === args.activeFileId) {
    publication = args.applyLocalContentUpdate(nextContent, {
      forcePreviewFullDocument: true,
    });
  } else {
    publication = args.applyFileContentUpdate(targetFileId, nextContent, {
      forcePreviewFullDocument: true,
    });
  }
  if (publication.status !== "accepted") return true;
  args.selectInsertedLayers(
    targetFileId,
    publication.content,
    insertion.rootNodeIds,
  );
  return true;
}
