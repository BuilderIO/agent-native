import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const CONTENT_CREATIVE_CONTEXT = defineLab({
  key: "content.creative-context",
  displayName: "Creative Context",
  description: "Connect and reuse governed reference context in Content.",
  keywords: "context creative library reference packs sources",
});

export const CONTENT_LABS = defineLabs([CONTENT_CREATIVE_CONTEXT]);
