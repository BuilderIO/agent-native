import type { ActionEntry } from "../agent/production-agent.js";
import { writeAppState } from "../application-state/script-helpers.js";
import {
  createExtension,
  deleteExtension,
  getHiddenExtensionIdsForCurrentUser,
  getExtension,
  hideExtension,
  listExtensions,
  unhideExtension,
  updateExtension,
  updateExtensionContent,
  type ExtensionRow,
} from "./store.js";
import { resolveAccess } from "../sharing/access.js";
import {
  addExtensionSlotTarget,
  installExtensionSlot,
  uninstallExtensionSlot,
  listExtensionsForSlot,
  listSlotsForExtension,
} from "./slots/store.js";

type ExtensionPatch = { find: string; replace: string };

export function createExtensionActionEntries(): Record<string, ActionEntry> {
  return {
    "list-extensions": {
      tool: {
        description:
          "List extensions visible in the current user's Extensions list/sidebar. Use this before updating, hiding, or deleting existing extensions; do not query the legacy tools table directly for extension management.",
        parameters: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description:
                "Optional case-insensitive filter matched against id, name, description, and owner email. Example: Connect Zoom.",
            },
            includeHidden: {
              type: "boolean",
              description:
                "Include extensions the current user has hidden from their list. Defaults to false.",
            },
            includeContent: {
              type: "boolean",
              description:
                "Include full Alpine.js content. Defaults to false to keep results concise.",
            },
            limit: {
              type: "number",
              description: "Maximum results to return. Defaults to 100.",
            },
          },
        },
      },
      run: async (args) => {
        const includeHidden = coerceBoolean(args?.includeHidden);
        const includeContent = coerceBoolean(args?.includeContent);
        const search = String(args?.search ?? "")
          .trim()
          .toLowerCase();
        const limit = coerceLimit(args?.limit);
        const hiddenIds = await getHiddenExtensionIdsForCurrentUser();

        let rows = await listExtensions({ includeHidden });
        if (search) {
          rows = rows.filter((row) =>
            [row.id, row.name, row.description, row.ownerEmail]
              .join("\n")
              .toLowerCase()
              .includes(search),
          );
        }

        rows = rows.slice(0, limit);
        const extensions = await Promise.all(
          rows.map((row) => summarizeExtension(row, hiddenIds, includeContent)),
        );
        return {
          ok: true,
          count: extensions.length,
          extensions,
        };
      },
      readOnly: true,
    },

    "create-extension": {
      tool: {
        description:
          "Create a sandboxed Alpine.js mini-app extension. Use this when the user asks to create, build, or make an extension/widget/dashboard/calculator. Call this action exactly once per requested extension. The content must be a self-contained Alpine.js HTML body snippet that can use appAction(), appFetch(), dbQuery(), dbExec(), extensionFetch(), and extensionData. Prefer appAction(name, params) for app data and actions, including read actions mounted as GET; do not call template /api/* routes from appFetch because the extension bridge only allows framework /_agent-native/* paths. Parse JSON string action results before aggregating; use dbQuery()/dbExec() only for known existing SQL tables.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                'Short display name for the extension. Do not include "app" — e.g. name a todo app "Todos", a weather app "Weather".',
            },
            description: {
              type: "string",
              description: "One-sentence summary of what the extension does.",
            },
            content: {
              type: "string",
              description:
                "Self-contained Alpine.js HTML body snippet. The iframe canvas already has modest default padding, so avoid duplicate outer padding unless the design needs it. Use semantic Tailwind colors (bg-background, text-foreground, bg-primary, etc.) for native theming. Do not include a full app build, React code, or source files.",
            },
            icon: {
              type: "string",
              description: "Optional icon name or short label.",
            },
          },
          required: ["name", "content"],
        },
      },
      run: async (args) => {
        const name = String(args?.name ?? "").trim();
        const content = String(args?.content ?? "").trim();
        if (!name) return "Error: name is required.";
        if (!content) return "Error: content is required.";

        const extension = await createExtension({
          name,
          description: String(args?.description ?? "").trim(),
          content,
          icon: args?.icon ? String(args.icon) : undefined,
        });

        // Auto-navigate so the user lands on the new extension instead of
        // having to read the JSON response and click a link. Writes a
        // one-shot `navigate` app-state command the UI consumes and clears.
        try {
          await writeAppState("navigate", {
            view: "extensions",
            extensionId: extension.id,
            path: `/extensions/${extension.id}`,
          });
        } catch {
          // Non-fatal — agent can still mention the path in its reply.
        }

        return {
          ok: true,
          extension,
          next: `Created. The user is being navigated to the new extension automatically — no further navigation tool calls needed.`,
        };
      },
    },

    "update-extension": {
      tool: {
        description:
          "Update an existing sandboxed Alpine.js mini-app extension. Prefer patches for surgical edits; use full content replacement only when necessary.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Extension id to update.",
            },
            name: {
              type: "string",
              description: "Optional new display name.",
            },
            description: {
              type: "string",
              description: "Optional new description.",
            },
            content: {
              type: "string",
              description:
                "Optional full replacement Alpine.js HTML body snippet.",
            },
            patches: {
              type: "string",
              description:
                'Optional JSON array of { "find": "...", "replace": "..." } patches to apply to the current content.',
            },
            icon: {
              type: "string",
              description: "Optional icon name or short label.",
            },
            visibility: {
              type: "string",
              description: "Optional sharing visibility.",
              enum: ["private", "org", "public"],
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";

        let result = null;
        if (args?.content !== undefined || args?.patches !== undefined) {
          const patches = parsePatches((args as any).patches);
          if (args?.patches !== undefined && !patches) {
            return "Error: patches must be a JSON array of { find, replace } objects.";
          }
          result = await updateExtensionContent(id, {
            content:
              args?.content !== undefined ? String(args.content) : undefined,
            patches,
          });
        }

        const meta: Record<string, string> = {};
        if (args?.name !== undefined) meta.name = String(args.name).trim();
        if (args?.description !== undefined) {
          meta.description = String(args.description).trim();
        }
        if (args?.icon !== undefined) meta.icon = String(args.icon);
        if (args?.visibility !== undefined) {
          meta.visibility = String(args.visibility);
        }
        if (Object.keys(meta).length > 0) {
          result = await updateExtension(id, meta as any);
        }

        if (!result) result = await getExtension(id);
        if (!result) return `Error: extension not found: ${id}`;
        return { ok: true, extension: result };
      },
    },

    "delete-extension": {
      tool: {
        description:
          "Permanently delete an extension everywhere it is shared. Requires owner/admin access. If the user only wants a shared extension removed from their own sidebar/list, use hide-extension instead.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Extension id to permanently delete. Use list-extensions first if you only know the display name.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const extension = await getExtension(id);
        if (!extension) return `Error: extension not found: ${id}`;

        try {
          const ok = await deleteExtension(id);
          if (!ok) return `Error: extension not found: ${id}`;
          return { ok: true, deleted: summarizeDeletedExtension(extension) };
        } catch (err: any) {
          return {
            ok: false,
            error: err?.message ?? String(err),
            next: "If the user wants this gone only from their own view, call hide-extension with the same id.",
          };
        }
      },
    },

    "hide-extension": {
      tool: {
        description:
          "Hide an accessible extension from the current user's Extensions list/sidebar without deleting it for anyone else. Use this when the user says to remove a shared extension from their view, or when delete-extension reports that the current user is not owner/admin.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Extension id to hide for the current user. Use list-extensions first if you only know the display name.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const extension = await getExtension(id);
        if (!extension) return `Error: extension not found: ${id}`;

        await hideExtension(id);
        return { ok: true, hidden: summarizeDeletedExtension(extension) };
      },
    },

    "unhide-extension": {
      tool: {
        description:
          "Restore an extension the current user previously hid so it appears in their Extensions list/sidebar again. Use list-extensions with includeHidden=true to find hidden ids.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Extension id to restore for the current user.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        await unhideExtension(id);
        return { ok: true, id };
      },
    },

    "add-extension-slot-target": {
      tool: {
        description:
          'Declare that an extension can render in a UI extension-point slot of an app (e.g. "mail.contact-sidebar.bottom"). Apps drop ExtensionSlot components in their UI; this action registers an extension as installable into one of those slots. Slot IDs follow the convention <app>.<area>.<position>. Caller must have editor access to the extension.',
        parameters: {
          type: "object",
          properties: {
            extensionId: { type: "string", description: "Extension id." },
            slotId: {
              type: "string",
              description:
                'Slot identifier — e.g. "mail.contact-sidebar.bottom".',
            },
            config: {
              type: "string",
              description:
                "Optional JSON string with slot-specific config (defaults, hints, etc.).",
            },
          },
          required: ["extensionId", "slotId"],
        },
      },
      run: async (args) => {
        const extensionId = String(args?.extensionId ?? "").trim();
        const slotId = String(args?.slotId ?? "").trim();
        if (!extensionId) return "Error: extensionId is required.";
        if (!slotId) return "Error: slotId is required.";
        const row = await addExtensionSlotTarget(
          extensionId,
          slotId,
          args?.config ? String(args.config) : undefined,
        );
        return { ok: true, slot: row };
      },
    },

    "install-extension": {
      tool: {
        description:
          "Install an extension as a widget in an extension-point slot for the current user. The extension must already declare the slot via add-extension-slot-target. Per-user installation — only affects the calling user's view. Use after creating an extension that targets a slot, or when the user asks to add an existing widget to a slot.",
        parameters: {
          type: "object",
          properties: {
            extensionId: {
              type: "string",
              description: "Extension id to install.",
            },
            slotId: {
              type: "string",
              description:
                'Slot identifier — e.g. "mail.contact-sidebar.bottom".',
            },
            position: {
              type: "number",
              description:
                "Optional integer position within the slot (lower = earlier). Defaults to end.",
            },
            config: {
              type: "string",
              description:
                "Optional JSON string with per-install config (overrides, settings).",
            },
          },
          required: ["extensionId", "slotId"],
        },
      },
      run: async (args) => {
        const extensionId = String(args?.extensionId ?? "").trim();
        const slotId = String(args?.slotId ?? "").trim();
        if (!extensionId) return "Error: extensionId is required.";
        if (!slotId) return "Error: slotId is required.";
        const position =
          args?.position !== undefined && args.position !== null
            ? Number(args.position)
            : undefined;
        const row = await installExtensionSlot(extensionId, slotId, {
          position: Number.isFinite(position as number) ? position : undefined,
          config: args?.config ? String(args.config) : undefined,
        });
        return { ok: true, install: row };
      },
    },

    "uninstall-extension": {
      tool: {
        description:
          "Remove an extension from an extension-point slot for the current user. Does not delete the extension itself.",
        parameters: {
          type: "object",
          properties: {
            extensionId: { type: "string", description: "Extension id." },
            slotId: { type: "string", description: "Slot identifier." },
          },
          required: ["extensionId", "slotId"],
        },
      },
      run: async (args) => {
        const extensionId = String(args?.extensionId ?? "").trim();
        const slotId = String(args?.slotId ?? "").trim();
        if (!extensionId) return "Error: extensionId is required.";
        if (!slotId) return "Error: slotId is required.";
        await uninstallExtensionSlot(extensionId, slotId);
        return { ok: true };
      },
    },

    "list-extensions-for-slot": {
      tool: {
        description:
          "List extensions the current user has access to that declare a given extension-point slot. Use to discover what's available to install into a slot the user mentioned.",
        parameters: {
          type: "object",
          properties: {
            slotId: { type: "string", description: "Slot identifier." },
          },
          required: ["slotId"],
        },
      },
      run: async (args) => {
        const slotId = String(args?.slotId ?? "").trim();
        if (!slotId) return "Error: slotId is required.";
        return { extensions: await listExtensionsForSlot(slotId) };
      },
      readOnly: true,
    },

    "list-extension-slots": {
      tool: {
        description:
          "List the extension-point slots a specific extension declares it can render in. Caller must have viewer access to the extension.",
        parameters: {
          type: "object",
          properties: {
            extensionId: { type: "string", description: "Extension id." },
          },
          required: ["extensionId"],
        },
      },
      run: async (args) => {
        const extensionId = String(args?.extensionId ?? "").trim();
        if (!extensionId) return "Error: extensionId is required.";
        return { slots: await listSlotsForExtension(extensionId) };
      },
      readOnly: true,
    },
  };
}

async function summarizeExtension(
  row: ExtensionRow,
  hiddenIds: Set<string>,
  includeContent: boolean,
) {
  const access = await resolveAccess("extension", row.id).catch(() => null);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    ownerEmail: row.ownerEmail,
    visibility: row.visibility,
    role: access?.role ?? null,
    canEdit: access
      ? ["owner", "admin", "editor"].includes(access.role)
      : false,
    canDelete: access ? ["owner", "admin"].includes(access.role) : false,
    hidden: hiddenIds.has(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(includeContent ? { content: row.content } : {}),
  };
}

function summarizeDeletedExtension(row: ExtensionRow) {
  return {
    id: row.id,
    name: row.name,
    ownerEmail: row.ownerEmail,
    visibility: row.visibility,
  };
}

function coerceBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function coerceLimit(value: unknown): number {
  const limit = Number(value ?? 100);
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(1, Math.floor(limit)), 500);
}

function parsePatches(value: unknown): ExtensionPatch[] | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return undefined;
  if (
    parsed.some(
      (patch) =>
        !patch ||
        typeof patch.find !== "string" ||
        typeof patch.replace !== "string",
    )
  ) {
    return undefined;
  }
  return parsed;
}
