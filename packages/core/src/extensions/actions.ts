import type { ActionEntry } from "../agent/production-agent.js";
import { createTool, getTool, updateTool, updateToolContent } from "./store.js";
import {
  addToolSlotTarget,
  installToolSlot,
  uninstallToolSlot,
  listToolsForSlot,
  listSlotsForTool,
} from "./slots/store.js";

type ToolPatch = { find: string; replace: string };

export function createToolActionEntries(): Record<string, ActionEntry> {
  return {
    "create-tool": {
      tool: {
        description:
          "Create a sandboxed Alpine.js mini-app tool. Use this when the user asks to create, build, or make a tool/widget/dashboard/calculator. The content must be a self-contained Alpine.js HTML body snippet that can use appAction(), appFetch(), dbQuery(), dbExec(), toolFetch(), and toolData.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                'Short display name for the tool. Do not include "app" — e.g. name a todo app "Todos", a weather app "Weather".',
            },
            description: {
              type: "string",
              description: "One-sentence summary of what the tool does.",
            },
            content: {
              type: "string",
              description:
                "Self-contained Alpine.js HTML body snippet. The iframe body has no padding, so add p-4 or p-6 to the outermost element. Use semantic Tailwind colors (bg-background, text-foreground, bg-primary, etc.) for native theming. Do not include a full app build, React code, or source files.",
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

        const tool = await createTool({
          name,
          description: String(args?.description ?? "").trim(),
          content,
          icon: args?.icon ? String(args.icon) : undefined,
        });

        return {
          ok: true,
          tool,
          next: `Navigate to /tools/${tool.id} or use the navigate action with --view=tools --toolId=${tool.id}.`,
        };
      },
    },

    "update-tool": {
      tool: {
        description:
          "Update an existing sandboxed Alpine.js mini-app tool. Prefer patches for surgical edits; use full content replacement only when necessary.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Tool id to update.",
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
          result = await updateToolContent(id, {
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
          result = await updateTool(id, meta as any);
        }

        if (!result) result = await getTool(id);
        if (!result) return `Error: tool not found: ${id}`;
        return { ok: true, tool: result };
      },
    },

    "add-tool-slot-target": {
      tool: {
        description:
          'Declare that a tool can render in a UI extension-point slot of an app (e.g. "mail.contact-sidebar.bottom"). Apps drop ExtensionSlot components in their UI; this action registers a tool as installable into one of those slots. Slot IDs follow the convention <app>.<area>.<position>. Caller must have editor access to the tool.',
        parameters: {
          type: "object",
          properties: {
            toolId: { type: "string", description: "Tool id." },
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
          required: ["toolId", "slotId"],
        },
      },
      run: async (args) => {
        const toolId = String(args?.toolId ?? "").trim();
        const slotId = String(args?.slotId ?? "").trim();
        if (!toolId) return "Error: toolId is required.";
        if (!slotId) return "Error: slotId is required.";
        const row = await addToolSlotTarget(
          toolId,
          slotId,
          args?.config ? String(args.config) : undefined,
        );
        return { ok: true, slot: row };
      },
    },

    "install-extension": {
      tool: {
        description:
          "Install a tool as a widget in an extension-point slot for the current user. The tool must already declare the slot via add-tool-slot-target. Per-user installation — only affects the calling user's view. Use after creating a tool that targets a slot, or when the user asks to add an existing widget to a slot.",
        parameters: {
          type: "object",
          properties: {
            toolId: { type: "string", description: "Tool id to install." },
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
          required: ["toolId", "slotId"],
        },
      },
      run: async (args) => {
        const toolId = String(args?.toolId ?? "").trim();
        const slotId = String(args?.slotId ?? "").trim();
        if (!toolId) return "Error: toolId is required.";
        if (!slotId) return "Error: slotId is required.";
        const position =
          args?.position !== undefined && args.position !== null
            ? Number(args.position)
            : undefined;
        const row = await installToolSlot(toolId, slotId, {
          position: Number.isFinite(position as number) ? position : undefined,
          config: args?.config ? String(args.config) : undefined,
        });
        return { ok: true, install: row };
      },
    },

    "uninstall-extension": {
      tool: {
        description:
          "Remove a tool from an extension-point slot for the current user. Does not delete the tool itself.",
        parameters: {
          type: "object",
          properties: {
            toolId: { type: "string", description: "Tool id." },
            slotId: { type: "string", description: "Slot identifier." },
          },
          required: ["toolId", "slotId"],
        },
      },
      run: async (args) => {
        const toolId = String(args?.toolId ?? "").trim();
        const slotId = String(args?.slotId ?? "").trim();
        if (!toolId) return "Error: toolId is required.";
        if (!slotId) return "Error: slotId is required.";
        await uninstallToolSlot(toolId, slotId);
        return { ok: true };
      },
    },

    "list-tools-for-slot": {
      tool: {
        description:
          "List tools the current user has access to that declare a given extension-point slot. Use to discover what's available to install into a slot the user mentioned.",
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
        return { tools: await listToolsForSlot(slotId) };
      },
      readOnly: true,
    },

    "list-tool-slots": {
      tool: {
        description:
          "List the extension-point slots a specific tool declares it can render in. Caller must have viewer access to the tool.",
        parameters: {
          type: "object",
          properties: {
            toolId: { type: "string", description: "Tool id." },
          },
          required: ["toolId"],
        },
      },
      run: async (args) => {
        const toolId = String(args?.toolId ?? "").trim();
        if (!toolId) return "Error: toolId is required.";
        return { slots: await listSlotsForTool(toolId) };
      },
      readOnly: true,
    },
  };
}

function parsePatches(value: unknown): ToolPatch[] | undefined {
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
