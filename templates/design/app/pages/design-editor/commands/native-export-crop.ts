import type { ElementInfo } from "@/components/design/types";
import { NativeSceneExportError } from "@/pages/design-editor/native-scene-export-client";
import {
  resolveExportCropTarget,
  resolveSelectedExportElements,
} from "@/pages/design-editor/png-export-render";

export type NativeExportCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  nodeId: string;
};

const MAX_CROP_ORIGIN = 1_000_000;

function readEditorContentOffset(doc: Document): { x: number; y: number } {
  const styles = doc.querySelectorAll(
    "style[data-agent-native-content-offset]",
  );
  if (styles.length === 0) return { x: 0, y: 0 };
  const css = styles[0]?.textContent?.trim();
  const match =
    styles.length === 1 &&
    /^body > \[data-agent-native-node-id\]\{translate:(-?\d+)px (-?\d+)px;\}$/.exec(
      css ?? "",
    );
  const x = match ? Number(match[1]) : Number.NaN;
  const y = match ? Number(match[2]) : Number.NaN;
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    Math.abs(x) > MAX_CROP_ORIGIN ||
    Math.abs(y) > MAX_CROP_ORIGIN
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The editor board offset is unreadable for the selected native export.",
    );
  return { x, y };
}

export function resolveNativeExportCrop(
  doc: Document | null,
  selection: ElementInfo | readonly ElementInfo[] | null,
): NativeExportCrop | null {
  if (!doc)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native scene is unavailable for cropping.",
    );
  const bodyTranslate =
    doc.body?.style.translate ||
    (doc.body && doc.defaultView?.getComputedStyle(doc.body).translate);
  if (bodyTranslate && bodyTranslate !== "none")
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native scene has an authored body translation that cannot be replaced by the export crop.",
    );
  const target = resolveExportCropTarget(doc, selection);
  if (target.kind === "unresolved")
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native element could not be resolved.",
    );
  if (target.kind === "whole-screen") return null;
  const elements = resolveSelectedExportElements(doc, selection);
  const editorOffset = readEditorContentOffset(doc);
  const nodeId = elements[0]?.getAttribute("data-agent-native-node-id");
  if (elements.length !== 1 || !nodeId)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "Native element export requires one selected authored node.",
    );
  const { width, height } = target.rect;
  const x = target.rect.x - editorOffset.x;
  const y = target.rect.y - editorOffset.y;
  const originValid =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= MAX_CROP_ORIGIN &&
    Math.abs(y) <= MAX_CROP_ORIGIN;
  const sizeValid =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    Number.isInteger(Math.ceil(width)) &&
    Number.isInteger(Math.ceil(height));
  if (!originValid || !sizeValid)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native element has unsupported crop geometry.",
    );
  return { x, y, width: Math.ceil(width), height: Math.ceil(height), nodeId };
}
