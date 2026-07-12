import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "decks",
  contentColumn: "data",
  idColumn: "id",
  resourceType: "deck",
  resolveResourceId: (docId) => {
    if (!docId.startsWith("deck-")) return docId;
    const withoutPrefix = docId.slice("deck-".length);
    const slideMarker = withoutPrefix.lastIndexOf("-slide-");
    return slideMarker >= 0
      ? withoutPrefix.slice(0, slideMarker)
      : withoutPrefix;
  },
});
