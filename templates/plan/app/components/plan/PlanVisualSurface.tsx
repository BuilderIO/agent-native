import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import type { PlanBlock, PlanContent } from "@shared/plan-content";
import type { PlanAnnotation } from "@shared/plan-content";
import {
  IconClick,
  IconLayoutBoard,
  IconPalette,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  CanvasArea,
  type CanvasMarkupMode,
  type CanvasMarkupCreateContext,
  type CanvasViewport,
  type DesignElementSelection,
} from "./CanvasArea";
import { PrototypeViewer } from "./PrototypeViewer";

type CanvasMarkupAnnotationInput = Omit<PlanAnnotation, "id">;
export type PlanVisualSurfaceMode = "prototype" | "wireframes" | "none";

type PlanVisualSurfaceProps = {
  canvas?: PlanContent["canvas"];
  prototype?: PlanContent["prototype"];
  blockLookup: Map<string, PlanBlock>;
  canvasMarkupMode?: CanvasMarkupMode;
  onCanvasMarkupCreate?: (
    annotation: CanvasMarkupAnnotationInput,
    context: CanvasMarkupCreateContext,
  ) => Promise<void> | void;
  onCanvasViewportChange?: (view: CanvasViewport) => void;
  onCanvasCommentShortcut?: () => void;
  prototypeOnly?: boolean;
  visualMode?: PlanVisualSurfaceMode;
  onVisualModeChange?: (mode: PlanVisualSurfaceMode) => void;
  onDesignElementStyleChange?: (
    selection: DesignElementSelection,
    styles: Record<string, string | null>,
  ) => Promise<void> | void;
};

export function PlanVisualSurface({
  canvas,
  prototype,
  blockLookup,
  canvasMarkupMode = "none",
  onCanvasMarkupCreate,
  onCanvasViewportChange,
  onCanvasCommentShortcut,
  prototypeOnly = false,
  visualMode: requestedVisualMode,
  onVisualModeChange,
  onDesignElementStyleChange,
}: PlanVisualSurfaceProps) {
  const t = useT();
  const designCanvas = isDesignCanvas(canvas);
  const [selectedDesignElement, setSelectedDesignElement] =
    useState<DesignElementSelection | null>(null);
  const selectedDesignElementKey = selectedDesignElement
    ? `${selectedDesignElement.frameId ?? ""}::${selectedDesignElement.blockId ?? ""}::${selectedDesignElement.elementId}`
    : null;
  const [tabValue, setTabValue] = useState<"prototype" | "wireframes">(
    designCanvas ? "wireframes" : prototype ? "prototype" : "wireframes",
  );
  const requestedTabValue =
    requestedVisualMode === "prototype" || requestedVisualMode === "wireframes"
      ? requestedVisualMode
      : undefined;
  const activeTabValue =
    prototype && canvas ? (requestedTabValue ?? tabValue) : tabValue;
  const visualMode = useMemo<PlanVisualSurfaceMode>(() => {
    if (prototypeOnly && prototype) return "prototype";
    if (prototype && canvas) return activeTabValue;
    if (prototype) return "prototype";
    if (canvas) return "wireframes";
    return "none";
  }, [activeTabValue, canvas, prototype, prototypeOnly]);

  useEffect(() => {
    if (requestedTabValue && tabValue !== requestedTabValue) {
      setTabValue(requestedTabValue);
    }
  }, [requestedTabValue, tabValue]);

  useEffect(() => {
    if (tabValue === "prototype" && !prototype && canvas) {
      setTabValue("wireframes");
    } else if (tabValue === "wireframes" && !canvas && prototype) {
      setTabValue("prototype");
    }
  }, [canvas, prototype, tabValue]);

  useEffect(() => {
    onVisualModeChange?.(visualMode);
  }, [onVisualModeChange, visualMode]);

  useEffect(() => {
    if (!designCanvas || visualMode !== "wireframes") {
      setSelectedDesignElement(null);
    }
  }, [designCanvas, visualMode]);

  if (prototypeOnly) {
    return prototype ? (
      <PrototypeViewer
        prototype={prototype}
        disableScreenClicks={canvasMarkupMode === "comment"}
        standalone
      />
    ) : null;
  }

  if (canvas && prototype) {
    return (
      <Tabs
        value={activeTabValue}
        onValueChange={(value) => {
          const next = value === "wireframes" ? "wireframes" : "prototype";
          setTabValue(next);
          onVisualModeChange?.(next);
        }}
        className="relative"
        data-plan-visual-tabs
      >
        <div
          className="absolute left-4 top-4 z-40"
          data-plan-interactive
          aria-label={t("raw.visual.visualReviewMode")}
        >
          <TabsList className="h-9 rounded-lg border border-plan-line bg-plan-chrome/90 p-1 shadow-xl backdrop-blur">
            <TabsTrigger
              value="prototype"
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <IconClick className="size-3.5" aria-hidden="true" />
              {t("raw.visual.prototype")}
            </TabsTrigger>
            <TabsTrigger
              value="wireframes"
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              {designCanvas ? (
                <IconPalette className="size-3.5" aria-hidden="true" />
              ) : (
                <IconLayoutBoard className="size-3.5" aria-hidden="true" />
              )}
              {designCanvas
                ? t("raw.visual.design")
                : t("raw.visual.wireframes")}
            </TabsTrigger>
          </TabsList>
        </div>
        {designCanvas && activeTabValue === "wireframes" && (
          <DesignStyleInspector
            selection={selectedDesignElement}
            onClear={() => setSelectedDesignElement(null)}
            onStyleChange={onDesignElementStyleChange}
          />
        )}
        <TabsContent value="prototype" className="m-0">
          <PrototypeViewer
            prototype={prototype}
            disableScreenClicks={canvasMarkupMode === "comment"}
          />
        </TabsContent>
        <TabsContent value="wireframes" className="m-0">
          <CanvasArea
            canvas={canvas}
            blockLookup={blockLookup}
            markupMode={canvasMarkupMode}
            onCanvasMarkupCreate={onCanvasMarkupCreate}
            onViewportChange={onCanvasViewportChange}
            onCommentShortcut={onCanvasCommentShortcut}
            selectedDesignElementKey={selectedDesignElementKey}
            onDesignElementSelect={
              designCanvas ? setSelectedDesignElement : undefined
            }
          />
        </TabsContent>
      </Tabs>
    );
  }

  if (prototype) {
    return (
      <PrototypeViewer
        prototype={prototype}
        disableScreenClicks={canvasMarkupMode === "comment"}
      />
    );
  }

  if (canvas) {
    return (
      <div className="relative">
        <CanvasArea
          canvas={canvas}
          blockLookup={blockLookup}
          markupMode={canvasMarkupMode}
          onCanvasMarkupCreate={onCanvasMarkupCreate}
          onViewportChange={onCanvasViewportChange}
          onCommentShortcut={onCanvasCommentShortcut}
          selectedDesignElementKey={selectedDesignElementKey}
          onDesignElementSelect={
            designCanvas ? setSelectedDesignElement : undefined
          }
        />
        {designCanvas && (
          <DesignStyleInspector
            selection={selectedDesignElement}
            onClear={() => setSelectedDesignElement(null)}
            onStyleChange={onDesignElementStyleChange}
          />
        )}
      </div>
    );
  }

  return null;
}

function isDesignCanvas(canvas: PlanContent["canvas"] | undefined) {
  return Boolean(
    canvas?.mode === "design" ||
    canvas?.frames.some((frame) => frame.wireframe?.renderMode === "design"),
  );
}

function DesignStyleInspector({
  selection,
  onClear,
  onStyleChange,
}: {
  selection: DesignElementSelection | null;
  onClear: () => void;
  onStyleChange?: (
    selection: DesignElementSelection,
    styles: Record<string, string | null>,
  ) => Promise<void> | void;
}) {
  const t = useT();
  if (!selection) return null;
  const canEdit = Boolean(onStyleChange);
  const apply = (property: string, value: string) => {
    if (!onStyleChange) return;
    void onStyleChange(selection, { [property]: value.trim() || null });
  };

  return (
    <div
      className="absolute right-4 top-16 z-40 w-72 rounded-xl border border-plan-line bg-plan-chrome/95 p-3 shadow-2xl backdrop-blur"
      data-plan-interactive
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-plan-muted">
            {t("raw.visual.designElement")}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-plan-text">
            {selection.elementId}
          </p>
          <p className="truncate text-xs text-plan-muted">
            {`<${selection.tagName}>`}
            {selection.text ? ` ${selection.text}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClear}
          aria-label={t("raw.visual.clearDesignSelection")}
        >
          <IconX className="size-4" />
        </Button>
      </div>
      <div className="grid gap-2">
        <StyleInput
          label="Text"
          value={selection.computedStyles.color}
          disabled={!canEdit}
          onCommit={(value) => apply("color", value)}
        />
        <StyleInput
          label="Fill"
          value={selection.computedStyles.backgroundColor}
          disabled={!canEdit}
          onCommit={(value) => apply("background-color", value)}
        />
        <StyleInput
          label="Radius"
          value={selection.computedStyles.borderRadius}
          disabled={!canEdit}
          onCommit={(value) => apply("border-radius", value)}
        />
        <StyleInput
          label="Padding"
          value={selection.computedStyles.padding}
          disabled={!canEdit}
          onCommit={(value) => apply("padding", value)}
        />
      </div>
    </div>
  );
}

function StyleInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-plan-muted">
        {label}
      </Label>
      <Input
        aria-label={label}
        value={draft}
        disabled={disabled}
        className="h-8 bg-background/80 text-xs"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          // Only commit when the draft actually changed to avoid spamming
          // plan updates and version snapshots on every focus-out.
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
