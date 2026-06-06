import { useEffect, useMemo, useState } from "react";
import { IconClick, IconLayoutBoard } from "@tabler/icons-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlanBlock, PlanContent } from "@shared/plan-content";
import {
  CanvasArea,
  type CanvasMarkupMode,
  type CanvasMarkupCreateContext,
} from "./CanvasArea";
import { PrototypeViewer } from "./PrototypeViewer";
import type { PlanAnnotation } from "@shared/plan-content";

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
  prototypeOnly?: boolean;
  visualMode?: PlanVisualSurfaceMode;
  onVisualModeChange?: (mode: PlanVisualSurfaceMode) => void;
};

export function PlanVisualSurface({
  canvas,
  prototype,
  blockLookup,
  canvasMarkupMode = "none",
  onCanvasMarkupCreate,
  prototypeOnly = false,
  visualMode: requestedVisualMode,
  onVisualModeChange,
}: PlanVisualSurfaceProps) {
  const [tabValue, setTabValue] = useState<"prototype" | "wireframes">(
    prototype ? "prototype" : "wireframes",
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
          aria-label="Visual review mode"
        >
          <TabsList className="h-9 rounded-lg border border-plan-line bg-plan-chrome/90 p-1 shadow-xl backdrop-blur">
            <TabsTrigger
              value="prototype"
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <IconClick className="size-3.5" aria-hidden="true" />
              Prototype
            </TabsTrigger>
            <TabsTrigger
              value="wireframes"
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <IconLayoutBoard className="size-3.5" aria-hidden="true" />
              Wireframes
            </TabsTrigger>
          </TabsList>
        </div>
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
      <CanvasArea
        canvas={canvas}
        blockLookup={blockLookup}
        markupMode={canvasMarkupMode}
        onCanvasMarkupCreate={onCanvasMarkupCreate}
      />
    );
  }

  return null;
}
