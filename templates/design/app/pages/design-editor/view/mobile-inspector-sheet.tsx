import { IconAdjustmentsHorizontal } from "@tabler/icons-react";

import { EditPanel } from "@/components/design/EditPanel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import { shouldAutoOpenMobileInspector } from "../minimal-inspector";

export function renderMobileInspectorSheet({
  editorCore,
  editorHistory,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  minimalInspectorHasSelection,
  editPanelProps,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  minimalInspectorHasSelection: boolean;
  editPanelProps: Omit<
    import("react").ComponentProps<typeof EditPanel>,
    "width"
  >;
}) {
  const { hostOwnsChrome, mode, setSelectedElement, t } = editorCore;
  const {
    minimalUi,
    isMobileViewport,
    setSelectedLayerIdsState,
    explicitOverviewScreenSelectionRef,
    setOverviewSelectedScreenIds,
  } = editorHistory;
  const { initialGenerationChromeLimited } = editorLiveEditsAndPresence;
  const { uiHidden } = editorContentAndComponents;

  return (
    <>
      {/* The inspector overlays the canvas in a narrow widget pane too. */}
      {!hostOwnsChrome &&
      !uiHidden &&
      !initialGenerationChromeLimited &&
      mode === "edit" ? (
        <Sheet
          open={
            minimalUi
              ? shouldAutoOpenMobileInspector({
                  minimalUi,
                  isMobileViewport,
                  hasSelection: minimalInspectorHasSelection,
                })
              : undefined
          }
          onOpenChange={
            minimalUi && isMobileViewport
              ? (nextOpen) => {
                  if (nextOpen) return;
                  setSelectedElement(null);
                  setSelectedLayerIdsState([]);
                  explicitOverviewScreenSelectionRef.current = [];
                  setOverviewSelectedScreenIds([]);
                }
              : undefined
          }
        >
          {!minimalUi ? (
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="fixed right-3 top-14 z-[75] rounded-full shadow-lg md:hidden"
                aria-label={t("editPanel.properties")}
              >
                <IconAdjustmentsHorizontal className="size-4" />
              </Button>
            </SheetTrigger>
          ) : null}
          <SheetContent
            side="right"
            className="w-[min(92vw,360px)] overflow-hidden p-0 md:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("editPanel.properties")}</SheetTitle>
            </SheetHeader>
            <div className="h-full min-h-0 pt-8">
              <EditPanel {...editPanelProps} width={320} />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
