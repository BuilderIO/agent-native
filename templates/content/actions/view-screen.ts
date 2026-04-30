import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { asc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Reads navigation state and fetches matching data.",
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;
    const db = getDb();

    if (nav?.documentId) {
      const access = await resolveAccess("document", nav.documentId);
      if (access) {
        const doc = access.resource;
        screen.document = {
          id: doc.id,
          parentId: doc.parentId,
          title: doc.title,
          content: doc.content,
          icon: doc.icon,
          position: doc.position,
          isFavorite: parseDocumentFavorite(doc.isFavorite),
          visibility: doc.visibility,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
      }
    }

    const docs = await db
      .select()
      .from(schema.documents)
      .where(accessFilter(schema.documents, schema.documentShares))
      .orderBy(asc(schema.documents.position));

    if (docs.length > 0) {
      screen.documentTree = {
        count: docs.length,
        items: docs.map((d) => ({
          id: d.id,
          parentId: d.parentId,
          title: d.title || "Untitled",
          icon: d.icon || undefined,
          isFavorite: parseDocumentFavorite(d.isFavorite),
          visibility: d.visibility,
        })),
      };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }

    const docCount = docs.length;
    console.error(
      `Current view: ${nav?.view ?? "list"}` +
        (nav?.documentId ? ` (document: ${nav.documentId})` : "") +
        ` — ${docCount} document(s) total`,
    );
    return screen;
  },
});
