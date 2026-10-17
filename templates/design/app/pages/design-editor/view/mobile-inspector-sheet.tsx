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

/**
 * The docked layout's inspector on a phone. Minimal UI floats the inspector
 * panel at every width, so it never opens this sheet.
 */
export function renderMobileInspectorSheet({
  editorCore,
  editorHistory,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editPanelProps,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editPanelProps: Omit<
    import("react").ComponentProps<typeof EditPanel>,
    "width"
  >;
}) {
  const { hostOwnsChrome, mode, t } = editorCore;
  const { minimalUi, motionDockOpen } = editorHistory;
  const { initialGenerationChromeLimited } = editorLiveEditsAndPresence;
  const { uiHidden } = editorContentAndComponents;

  return (
    <>
      {!hostOwnsChrome &&
      !minimalUi &&
      !uiHidden &&
      !initialGenerationChromeLimited &&
      mode === "edit" &&
      !editPanelProps.readOnly ? (
        <Sheet modal={!motionDockOpen}>
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
          <SheetContent
            side="right"
            onInteractOutside={(event) => {
              if (motionDockOpen) event.preventDefault();
            }}
            className={
              motionDockOpen
                ? "w-[min(max(240px,48vw),360px)] overflow-hidden p-0 md:hidden"
                : "w-[min(92vw,360px)] overflow-hidden p-0 md:hidden"
            }
            showOverlay={!motionDockOpen}
            style={
              motionDockOpen
                ? {
                    bottom: "var(--design-motion-dock-height, 0px)",
                    height: "auto",
                  }
                : undefined
            }
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("editPanel.properties")}</SheetTitle>
            </SheetHeader>
            <div className="h-full min-h-0 pt-8 [&>.design-sidebar]:!w-full">
              <EditPanel {...editPanelProps} width={320} />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
