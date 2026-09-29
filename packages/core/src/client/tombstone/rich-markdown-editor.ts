import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/rich-markdown-editor",
  "@agent-native/toolkit/editor",
  {
    RegistryBlockDataProvider: "@agent-native/toolkit/app/blocks",
    uploadEditorImage: "@agent-native/core/client/uploads",
  },
);

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const BubbleToolbar =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const DEFAULT_CODE_LANGUAGES =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const DEFAULT_SLASH_COMMANDS =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const DragHandle =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const MARKDOWN_DIALECT_CONFIG =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RUN_ID_NODE_TYPES =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/app/blocks. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RegistryBlockDataProvider =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/app/blocks. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RegistryBlockNodeView =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RichMarkdownEditor =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RunId =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const SharedImage =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const SharedRichEditor =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const SlashCommandMenu =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const applyDocSurgically =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const buildDefaultBubbleItems =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const buildRegistryBlockSlashItems =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const createCodeBlockNode =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const createImageExtension =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const createImageSlashCommand =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const createRegistryBlockNode =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const createRichMarkdownExtensions =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const createSharedEditorExtensions =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const defaultParseValue =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const diffTopLevel =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const getEditorMarkdown =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const getRegistryBlockSlashDescription =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const getRegistryBlockSlashSearchText =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const gfmToProseJSON =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const pickAndInsertImage =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const proseJSONToGfm =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/core/client/uploads. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const uploadEditorImage =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/core/client/uploads. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const useCollabReconcile =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const useRegistryBlockData =
  undefined as DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type BubbleToolbarItem =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type BubbleToolbarProps =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type BuildRegistryBlockSlashItemsOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type CodeBlockClassNames =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type CodeLanguageOption =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type CreateCodeBlockNodeOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type CreateRegistryBlockNodeOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type CreateRichMarkdownExtensionsOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type CreateSharedEditorExtensionsOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type DragHandleDropContext =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type DragHandleDropPlacement =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type DragHandleOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type ImageUploadFn =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RegistryBlockDataValue =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RegistryBlockSideMapBlock =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RichMarkdownCollabUser =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RichMarkdownDialect =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RichMarkdownEditorPreset =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RichMarkdownEditorProps =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type SharedEditorCollab =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type SharedEditorFeatures =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type SharedImageOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type SharedRichEditorProps =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type SlashCommandItem =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type SlashCommandMenuProps =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type TopLevelDiff =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type UseCollabReconcileOptions =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type UseCollabReconcileResult =
  DeprecatedExport<"@agent-native/core/client/rich-markdown-editor moved to @agent-native/toolkit/editor. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;
