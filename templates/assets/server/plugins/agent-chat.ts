import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, desc, isNull } from "drizzle-orm";

import actionsRegistry from "../../.generated/actions-registry.js";
import { accessibleTemplateFilter } from "../../actions/_template-access.js";
import { getDb, schema } from "../db/index.js";
import { prepareTemplateChatContext } from "../lib/template-chat-context.js";
import "../register-secrets.js";

const ASSETS_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;

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
  mcp: {
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
  // When a user tags an @template, embed its aesthetics/philosophy into the
  // model-facing message so the agent internalizes the brief before generating.
  prepareRequest: ({ message, references }) =>
    prepareTemplateChatContext({ message, references }),
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
    templates: {
      label: "Templates",
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
          const libraryTitleById = new Map(
            libraryRows.map((library) => [library.id, library.title]),
          );
          const rows = await db
            .select({
              id: schema.assetTemplates.id,
              libraryId: schema.assetTemplates.libraryId,
              title: schema.assetTemplates.title,
              description: schema.assetTemplates.description,
              aspectRatio: schema.assetTemplates.aspectRatio,
              imageSize: schema.assetTemplates.imageSize,
              model: schema.assetTemplates.model,
              mediaType: schema.assetTemplates.mediaType,
              sortOrder: schema.assetTemplates.sortOrder,
            })
            .from(schema.assetTemplates)
            .where(await accessibleTemplateFilter())
            .orderBy(
              asc(schema.assetTemplates.sortOrder),
              asc(schema.assetTemplates.title),
            );
          const q = query.trim().toLowerCase();
          return rows
            .filter((template) => {
              if (!q) return true;
              const libraryTitle = template.libraryId
                ? (libraryTitleById.get(template.libraryId) ?? "")
                : "Global";
              return [
                template.id,
                template.title,
                template.description ?? "",
                libraryTitle,
                template.aspectRatio,
                template.imageSize,
                template.model,
                template.mediaType,
              ]
                .join(" ")
                .toLowerCase()
                .includes(q);
            })
            .slice(0, 20)
            .map((template) => {
              const libraryTitle = template.libraryId
                ? (libraryTitleById.get(template.libraryId) ?? "Brand kit")
                : null;
              return {
                id: `template:${template.id}`,
                label: template.title,
                description: `${libraryTitle ?? "Global"} · ${template.aspectRatio} · ${template.imageSize} · ${template.model}`,
                icon: "document",
                refType: "template",
                refId: template.id,
                refPath: `/templates/${template.id}`,
                slotKey: "template",
                slotLabel: "Template",
                metadata: {
                  ...(template.libraryId
                    ? {
                        libraryId: template.libraryId,
                        libraryTitle,
                        requiredSlotKey: "brand-kit",
                        requiredRefId: template.libraryId,
                      }
                    : {}),
                  mediaType: template.mediaType,
                },
                relatedReferences: template.libraryId
                  ? [
                      {
                        label: libraryTitle ?? "Brand kit",
                        icon: "folder",
                        source: "brandKits",
                        refType: "brand-kit",
                        refId: template.libraryId,
                        refPath: `/library/${template.libraryId}`,
                        slotKey: "brand-kit",
                        slotLabel: "Brand kit",
                        clearsSlots: ["template"],
                        metadata: {
                          libraryId: template.libraryId,
                        },
                      },
                    ]
                  : [],
              };
            });
        } catch (err) {
          console.error("[assets] Template mention provider failed:", err);
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
              clearsSlots: ["template"],
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
  durableBackgroundRuns: true,
  runSoftTimeoutMs: ASSETS_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
});
