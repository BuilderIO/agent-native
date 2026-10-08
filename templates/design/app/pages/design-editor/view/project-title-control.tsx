import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { DesignData } from "../types";

export function renderProjectTitleControl({
  editorCore,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  design,
}: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  design: DesignData;
}) {
  const { t } = editorCore;
  const { canEditDesign } = editorGenerationAndAccess;
  const {
    titleEditing,
    titleDraft,
    setTitleDraft,
    commitTitleEdit,
    handleTitleInputKeyDown,
    setTitleEditing,
  } = editorFilesAndSaving;

  return titleEditing && canEditDesign ? (
    <Input
      autoFocus
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={commitTitleEdit}
      onKeyDown={handleTitleInputKeyDown}
      className="-mx-1 h-7 min-w-0 flex-1 border-transparent bg-[var(--design-editor-panel-raised-bg)] px-1 py-0 text-[13px] font-medium text-foreground shadow-none ring-offset-0 focus-visible:border-[var(--design-editor-control-border)] focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0"
    />
  ) : canEditDesign ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (!canEditDesign) return;
            setTitleDraft(design.title);
            setTitleEditing(true);
          }}
          disabled={!canEditDesign}
          className="-mx-1 min-w-0 flex-1 cursor-text truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/50"
        >
          {design.title}
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("designEditor.clickToRename")}</TooltipContent>
    </Tooltip>
  ) : (
    <span className="-mx-1 min-w-0 flex-1 truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90">
      {design.title}
    </span>
  );
}
