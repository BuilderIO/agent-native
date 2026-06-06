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
  prototypeCommentsVisible?: boolean;
  onPrototypeCommentsToggle?: () => void;
};

export function PlanVisualSurface({
  canvas,
  prototype,
  blockLookup,
  canvasMarkupMode = "none",
  onCanvasMarkupCreate,
  prototypeOnly = false,
  prototypeCommentsVisible = false,
  onPrototypeCommentsToggle,
}: PlanVisualSurfaceProps) {
  if (prototypeOnly) {
    return prototype ? (
      <PrototypeViewer
        prototype={prototype}
        commentsVisible={prototypeCommentsVisible}
        onToggleComments={onPrototypeCommentsToggle}
        disableScreenClicks={canvasMarkupMode === "comment"}
        standalone
      />
    ) : null;
  }

  if (canvas && prototype) {
    return (
      <Tabs defaultValue="prototype" className="relative" data-plan-visual-tabs>
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
            commentsVisible={prototypeCommentsVisible}
            onToggleComments={onPrototypeCommentsToggle}
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
        commentsVisible={prototypeCommentsVisible}
        onToggleComments={onPrototypeCommentsToggle}
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
