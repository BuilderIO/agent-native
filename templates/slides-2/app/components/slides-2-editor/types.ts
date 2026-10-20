import type { Rect } from "./geometry";

export type SlideSource = {
  id: string;
  deckId: string;
  position: number;
  sourceTsx: string;
  revision: number;
  sourceHash: string;
  notes?: string | null;
  transition?: string | null;
};

export type SourceEditOp =
  | { kind: "set-style"; key: string; value: string | null; prevText?: string }
  | { kind: "set-text"; value: string; prevText?: string }
  | {
      kind: "set-text-range-style";
      start: number;
      end: number;
      key: string;
      value: string | null;
      prevText?: string;
    }
  | { kind: "set-attr-asset"; attr: "src"; assetId: string }
  | { kind: "replace-placeholder-with-image"; assetId: string };

export type SourceEdit = {
  line: number;
  column: number;
  ops: SourceEditOp[];
  dependsOn?: number;
};

export type SourceEditResult = { ok: boolean; error?: string };

export type ElementSnapshot = {
  nodeId: string;
  line: number;
  column: number;
  instanceIndex?: number;
  instanceCount?: number;
  tagName: string;
  bounds: Rect;
  text: string;
  styles: Record<string, string>;
  ancestorLocators?: string[];
  ancestorLocatorsComplete?: boolean;
  transform?: {
    basis: { a: number; b: number; c: number; d: number };
    translate: { x: number; y: number };
    width: number;
    height: number;
    rotation: number;
  };
};

export type InspectorStyles = {
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  color: string;
  backgroundColor: string;
  opacity: string;
  borderRadius: string;
  padding: string;
  display: string;
  position: string;
  zIndex: string;
};

export type EditorSelection = {
  line: number;
  column: number;
  nodeIds: string[];
};
