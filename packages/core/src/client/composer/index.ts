export { FileReference } from "./extensions/FileReference.js";
export { SkillReference } from "./extensions/SkillReference.js";
export { MentionReference } from "./extensions/MentionReference.js";
export {
  AgentComposerFrame,
  type AgentComposerFrameProps,
} from "./AgentComposerFrame.js";
export {
  TiptapComposer,
  canSubmitComposerContent,
  displayableComposerModeMessage,
  getComposerSubmitIntentForEnterKey,
  handleComposerFileDrop,
  insertComposerHardBreakAndScrollIntoView,
  type ComposerSubmitIntent,
  type TiptapComposerHandle,
  type TiptapComposerProps,
  type TiptapComposerSubmitOptions,
} from "./TiptapComposer.js";
export {
  PromptComposer,
  type PromptComposerProps,
  type PromptComposerFile,
  type PromptComposerSubmitOptions,
} from "./PromptComposer.js";
export {
  AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES,
  AGENT_PROMPT_MAX_INLINE_TEXT_CHARS,
  escapePromptAttachmentAttribute,
  formatPromptWithAttachments,
  isInlineableAgentPromptFile,
  readAgentPromptAttachment,
  type AgentPromptAttachment,
  type ReadAgentPromptAttachmentOptions,
} from "./prompt-attachments.js";
export { MentionPopover } from "./MentionPopover.js";
export { useMentionSearch } from "./use-mention-search.js";
export type {
  AgentComposerLayoutVariant,
  FileResult,
  SkillResult,
  MentionItem,
  Reference,
  SlashCommand,
} from "./types.js";
