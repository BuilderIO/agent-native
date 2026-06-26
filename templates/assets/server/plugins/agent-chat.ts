import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, desc, inArray, isNull } from "drizzle-orm";

import actionsRegistry from "../../.generated/actions-registry.js";
import { getDb, schema } from "../db/index.js";
import "../register-secrets.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-libraries",
  "list-assets",
  "search-assets",
  "get-asset",
  "generate-image",
  "generate-image-batch",
  "edit-image",
  "restyle-image",
  "refine-image",
  "save-generated-asset",
  "export-asset",
  "create-library",
  "create-collection",
  "open-asset-picker",
  "navigate",
];

export default createAgentChatPlugin({
  appId: "assets",
  mcpServerInfo: {
    title: "Agent-Native Assets",
    description:
      "Create, search, select, and export brand image and video assets from Assets.",
    websiteUrl: "/",
    icons: [
      {
        src: "/agent-native-icon-light-512.png?v=20260530",
        mimeType: "image/png",
        sizes: ["512x512"],
      },
    ],
  },
  initialToolNames: INITIAL_TOOL_NAMES,
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  mentionProviders: {
    mediaTypes: {
      label: "Media type",
      icon: "file",
      search: (query: string) => {
        const q = query.trim().toLowerCase();
        return [
          {
            id: "media-type:image",
            label: "Image",
            description: "Generate image assets",
            icon: "file",
            refType: "media-type",
            refId: "image",
            slotKey: "media-type",
            slotLabel: "Media",
          },
          {
            id: "media-type:video",
            label: "Video",
            description: "Generate video assets",
            icon: "file",
            refType: "media-type",
            refId: "video",
            slotKey: "media-type",
            slotLabel: "Media",
          },
        ].filter((item) =>
          q
            ? item.label.toLowerCase().includes(q) ||
              item.refId.toLowerCase().includes(q)
            : true,
        );
      },
    },
    presets: {
      label: "Presets",
      icon: "document",
      search: async (query: string) => {
        try {
          const db = getDb();
          const libraryRows = await db
            .select({
              id: schema.assetLibraries.id,
              title: schema.assetLibraries.title,
            })
            .from(schema.assetLibraries)
            .where(
              and(
                accessFilter(schema.assetLibraries, schema.assetLibraryShares),
                isNull(schema.assetLibraries.archivedAt),
              ),
            )
            .orderBy(desc(schema.assetLibraries.updatedAt));
          const libraryIds = libraryRows.map((library) => library.id);
          if (!libraryIds.length) return [];
          const libraryTitleById = new Map(
            libraryRows.map((library) => [library.id, library.title]),
          );
          const rows = await db
            .select({
              id: schema.assetGenerationPresets.id,
              libraryId: schema.assetGenerationPresets.libraryId,
              title: schema.assetGenerationPresets.title,
              description: schema.assetGenerationPresets.description,
              aspectRatio: schema.assetGenerationPresets.aspectRatio,
              imageSize: schema.assetGenerationPresets.imageSize,
              model: schema.assetGenerationPresets.model,
              mediaType: schema.assetGenerationPresets.mediaType,
              sortOrder: schema.assetGenerationPresets.sortOrder,
            })
            .from(schema.assetGenerationPresets)
            .where(inArray(schema.assetGenerationPresets.libraryId, libraryIds))
            .orderBy(
              asc(schema.assetGenerationPresets.sortOrder),
              asc(schema.assetGenerationPresets.title),
            );
          const q = query.trim().toLowerCase();
          return rows
            .filter((preset) => {
              if (!q) return true;
              const libraryTitle = libraryTitleById.get(preset.libraryId) ?? "";
              return [
                preset.id,
                preset.title,
                preset.description ?? "",
                libraryTitle,
                preset.aspectRatio,
                preset.imageSize,
                preset.model,
                preset.mediaType,
              ]
                .join(" ")
                .toLowerCase()
                .includes(q);
            })
            .slice(0, 20)
            .map((preset) => {
              const libraryTitle =
                libraryTitleById.get(preset.libraryId) ?? "Brand kit";
              return {
                id: `preset:${preset.id}`,
                label: preset.title,
                description: `${libraryTitle} · ${preset.aspectRatio} · ${preset.imageSize} · ${preset.model}`,
                icon: "document",
                refType: "preset",
                refId: preset.id,
                refPath: `/library/${preset.libraryId}`,
                slotKey: "preset",
                slotLabel: "Preset",
                metadata: {
                  libraryId: preset.libraryId,
                  libraryTitle,
                  requiredSlotKey: "brand-kit",
                  requiredRefId: preset.libraryId,
                  mediaType: preset.mediaType,
                },
                relatedReferences: [
                  {
                    label: libraryTitle,
                    icon: "folder",
                    source: "brandKits",
                    refType: "brand-kit",
                    refId: preset.libraryId,
                    refPath: `/library/${preset.libraryId}`,
                    slotKey: "brand-kit",
                    slotLabel: "Brand kit",
                    clearsSlots: ["preset"],
                    metadata: {
                      libraryId: preset.libraryId,
                    },
                  },
                ],
              };
            });
        } catch (err) {
          console.error("[assets] Preset mention provider failed:", err);
          return [];
        }
      },
    },
    brandKits: {
      label: "Brand kits",
      icon: "folder",
      search: async (query: string) => {
        try {
          const rows = await getDb()
            .select({
              id: schema.assetLibraries.id,
              title: schema.assetLibraries.title,
              description: schema.assetLibraries.description,
              updatedAt: schema.assetLibraries.updatedAt,
            })
            .from(schema.assetLibraries)
            .where(
              and(
                accessFilter(schema.assetLibraries, schema.assetLibraryShares),
                isNull(schema.assetLibraries.archivedAt),
              ),
            )
            .orderBy(desc(schema.assetLibraries.updatedAt));
          const q = query.trim().toLowerCase();
          return rows
            .filter((library) => {
              if (!q) return true;
              return [library.id, library.title, library.description ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(q);
            })
            .slice(0, 20)
            .map((library) => ({
              id: `brand-kit:${library.id}`,
              label: library.title,
              description: library.description ?? `/library/${library.id}`,
              icon: "folder",
              refType: "brand-kit",
              refId: library.id,
              refPath: `/library/${library.id}`,
              slotKey: "brand-kit",
              slotLabel: "Brand kit",
              clearsSlots: ["preset"],
              metadata: {
                libraryId: library.id,
              },
            }));
        } catch (err) {
          console.error("[assets] Brand kit mention provider failed:", err);
          return [];
        }
      },
    },
  },
  runSoftTimeoutMs: 240_000,
});
