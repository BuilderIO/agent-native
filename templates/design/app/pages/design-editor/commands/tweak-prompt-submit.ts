import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import type { TweakDefinition } from "@shared/api";
import type { TweakSelections } from "@shared/resolve-tweaks";
import { toast } from "sonner";

import type { UploadedFile } from "@/components/editor/PromptDialog";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import { TWEAK_CONTROLS_EDIT_ACCESS_MESSAGE } from "@/pages/design-editor/editor-constants";
import {
  formatTweakDefinitionsContext,
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
} from "@/pages/design-editor/generation-prompt-directives";
import type { DesignData, DesignFile } from "@/pages/design-editor/types";

export interface TweakPromptSubmitArgs {
  activeFile: DesignFile;
  canEditDesign: boolean;
  design: DesignData | null;
  handleTweakPromptOpenChange: (open: boolean) => void;
  id: string | undefined;
  tweakSelections: TweakSelections;
  tweaks: TweakDefinition[];
}

export function runTweakPromptSubmit(
  {
    activeFile,
    canEditDesign,
    design,
    handleTweakPromptOpenChange,
    id,
    tweakSelections,
    tweaks,
  }: TweakPromptSubmitArgs,
  prompt: string,
  files: UploadedFile[],
  options: PromptComposerSubmitOptions,
) {
  if (!canEditDesign) {
    toast.error(TWEAK_CONTROLS_EDIT_ACCESS_MESSAGE);
    return;
  }
  if (!design) return;
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const fileContext = formatUploadedFileContext(files);
  const images = imageAttachmentsFromUploadedFiles(files);
  const currentSelections =
    Object.keys(tweakSelections).length > 0
      ? JSON.stringify(tweakSelections, null, 2)
      : "None yet.";
  const context = [
    `The user is in the Design editor tweaks panel for design id "${id}" (title: "${design.title}").`,
    activeFile
      ? `Active file: "${activeFile.filename}" (file id: "${activeFile.id}").`
      : "There is no active file yet.",
    `User request: "${trimmed}"`,
    "",
    "Existing tweak definitions:",
    formatTweakDefinitionsContext(tweaks),
    "",
    "Current selected tweak values:",
    currentSelections,
    fileContext,
    "",
    "Add or update live tweak controls for this design. Keep existing useful tweak controls unless the user explicitly asks to replace them.",
    "If a requested control needs a new CSS custom property, first read the live design with `get-design-snapshot`, update the relevant HTML/CSS so the property is used, then persist the complete updated tweak definition list through `generate-design`.",
    "For tiny source changes, prefer `edit-design`, but make sure the tweak definitions are saved so the Tweaks panel updates.",
  ].join("\n");

  sendToDesignAgentChat({
    message: `Add tweak controls to "${design.title}": ${trimmed}`,
    context,
    submit: true,
    openSidebar: true,
    newTab: true,
    model: options.model,
    engine: options.engine,
    effort: options.effort,
    images,
  });
  handleTweakPromptOpenChange(false);
}
