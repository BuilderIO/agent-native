import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const CONTENT_CREATIVE_CONTEXT = defineLab({
  key: "content.creative-context",
  displayName: "Creative Context",
  description: "Connect and reuse governed reference context in Content.",
  keywords: "context creative library reference packs sources",
});

export const CONTENT_SLASH_ADVANCED_CODE = defineLab({
  key: "content.slash.advanced-code",
  displayName: "Advanced code blocks",
  description: "Add structured code and code-tabs blocks to the slash menu.",
  keywords: "slash commands code tabs",
});

export const CONTENT_SLASH_LAYOUTS = defineLab({
  key: "content.slash.layouts",
  displayName: "Layout blocks",
  description: "Add custom HTML and tabs blocks to the slash menu.",
  keywords: "slash commands html tabs layout",
});

export const CONTENT_SLASH_VISUALS = defineLab({
  key: "content.slash.visuals",
  displayName: "Visual blocks",
  description: "Add diagram, Mermaid, and wireframe blocks to the slash menu.",
  keywords: "slash commands diagram mermaid wireframe",
});

export const CONTENT_SLASH_DEVELOPER_DOCS = defineLab({
  key: "content.slash.developer-docs",
  displayName: "Developer documentation blocks",
  description: "Add API and developer-documentation blocks to the slash menu.",
  keywords: "slash commands api openapi data model diff file tree json",
});

export const CONTENT_LABS = defineLabs([
  CONTENT_CREATIVE_CONTEXT,
  CONTENT_SLASH_ADVANCED_CODE,
  CONTENT_SLASH_LAYOUTS,
  CONTENT_SLASH_VISUALS,
  CONTENT_SLASH_DEVELOPER_DOCS,
]);
