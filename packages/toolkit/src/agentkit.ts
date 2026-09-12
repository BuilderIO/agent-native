/**
 * The narrow Toolkit surface consumed by AgentKit's React package.
 *
 * Keeping this boundary explicit lets browser tooling precompile the complete
 * Chat UI graph as one coherent unit without treating Toolkit's unrelated
 * editor, dashboard, and collaboration surfaces as AgentKit dependencies.
 */
export { writeClipboardText } from "./clipboard.js";
export {
  AgentSuggestionBar,
  agentSuggestionPrompt,
} from "./composer/AgentSuggestionBar.js";
export { MessageQueueDrawer } from "./composer/MessageQueueDrawer.js";
export {
  PromptComposer,
  type PromptComposerFile,
  type PromptComposerProps,
} from "./composer/PromptComposer.js";
export type { TiptapComposerHandle } from "./composer/TiptapComposer.js";
export {
  ActionButton,
  IconButton,
  Surface,
  TextField,
} from "./design-system/index.js";
export { splitMarkdownBlocks } from "./markdown-block-split.js";
export {
  initialSmoothStreamingGraphemeCount,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
  SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
} from "./streaming-text-smoothing.js";
