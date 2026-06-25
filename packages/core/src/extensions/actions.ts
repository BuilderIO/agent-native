import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { AgentChatAttachment } from "../agent/types.js";
import { writeAppState } from "../application-state/script-helpers.js";
import { resolveAccess } from "../sharing/access.js";
import type {
  ExtensionContentEdit,
  ExtensionLegacyPatch,
} from "./content-patch.js";
import {
  getLocalExtension,
  isLocalExtensionRow,
  listLocalExtensions,
  type LocalExtensionRow,
} from "./local.js";
import { extensionPath } from "./path.js";
import {
  addExtensionSlotTarget,
  installExtensionSlot,
  uninstallExtensionSlot,
  listExtensionsForSlot,
  listSlotsForExtension,
} from "./slots/store.js";
import {
  createExtension,
  deleteExtension,
  findRecentDuplicateExtension,
  getHiddenExtensionIdsForCurrentUser,
  getExtension,
  getExtensionHistoryVersion,
  globalHideExtension,
  globalUnhideExtension,
  hideExtension,
  listExtensionHistory,
  listExtensions,
  restoreExtensionHistoryVersion,
  unhideExtension,
  updateExtension,
  updateExtensionContent,
  type ExtensionRow,
} from "./store.js";

export function createExtensionActionEntries(): Record<string, ActionEntry> {
  return {
    "list-extensions": {
      tool: {
        description:
          "List extensions visible in the current user's Extensions list/sidebar. Use this for browsing or when you only know a display name. If <current-screen> or <current-url> already contains extensionId for the current extension, use get-extension or update-extension with that id directly instead of listing. Do not query the legacy tools table directly for extension management.",
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
            includeGloballyHidden: {
              type: "boolean",
              description:
                "Include extensions an admin/owner has globally hidden from everyone (via global-hide-extension). Defaults to false. Use this to find ids to unhide for everyone.",
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
        const includeGloballyHidden = coerceBoolean(
          args?.includeGloballyHidden,
        );
        const includeContent = coerceBoolean(args?.includeContent);
        const search = String(args?.search ?? "")
          .trim()
          .toLowerCase();
        const limit = coerceLimit(args?.limit);
        const hiddenIds = await getHiddenExtensionIdsForCurrentUser();

        let rows: Array<ExtensionRow | LocalExtensionRow> =
          await listExtensions({
            includeHidden,
            includeGloballyHidden,
          });
        const localRows = await listLocalExtensions();
        const allRows: Array<ExtensionRow | LocalExtensionRow> = [
          ...rows,
          ...localRows,
        ];
        if (search) {
          rows = allRows.filter((row) =>
            [row.id, row.name, row.description, row.ownerEmail]
              .join("\n")
              .toLowerCase()
              .includes(search),
          );
        } else {
          rows = allRows;
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

    "get-extension": {
      tool: {
        description:
          "Get one existing extension by id. Use this when <current-screen> or <current-url> contains extensionId for the current extension; do not call list-extensions just to rediscover that id. Defaults to including the full Alpine.js content so you can make a targeted update-extension edit.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Extension id to read. Prefer the extensionId from <current-screen> or <current-url> when the user refers to the current extension.",
            },
            includeContent: {
              type: "boolean",
              description:
                "Include full Alpine.js content. Defaults to true for targeted edits.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const includeContent =
          args?.includeContent === undefined
            ? true
            : coerceBoolean(args.includeContent);
        const localExtension = await getLocalExtension(id);
        if (localExtension) {
          return {
            ok: true,
            extension: await summarizeExtension(
              localExtension,
              new Set(),
              includeContent,
            ),
          };
        }
        const extension = await getExtension(id);
        if (!extension) return `Error: extension not found: ${id}`;
        const hiddenIds = await getHiddenExtensionIdsForCurrentUser();
        return {
          ok: true,
          extension: await summarizeExtension(
            extension,
            hiddenIds,
            includeContent,
          ),
        };
      },
      readOnly: true,
    },

    "list-extension-history": {
      tool: {
        description:
          "List saved history snapshots for one extension. Use this when the user asks what changed, wants a changelog, or wants to pick an older version to restore. If the user is viewing the extension, use the extensionId from <current-screen> or <current-url>.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Extension id whose history should be listed.",
            },
            limit: {
              type: "number",
              description: "Maximum versions to return. Defaults to 50.",
            },
            includeContent: {
              type: "boolean",
              description:
                "Include full HTML content for each version. Defaults to false.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const localMessage = await localExtensionReadonlyHistoryMessage(id);
        if (localMessage) return localMessage;
        const history = await listExtensionHistory(id, {
          limit:
            args?.limit === undefined ? undefined : coerceLimit(args.limit),
          includeContent: coerceBoolean(args?.includeContent),
        });
        return {
          ok: true,
          count: history.length,
          history,
        };
      },
      readOnly: true,
    },

    "get-extension-history-version": {
      tool: {
        description:
          "Get one extension history version with its previous-version diff. Use after list-extension-history when the user wants to inspect exactly what changed.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Extension id whose history version should be read.",
            },
            version: {
              type: "number",
              description: "History version number to inspect.",
            },
          },
          required: ["id", "version"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const localMessage = await localExtensionReadonlyHistoryMessage(id);
        if (localMessage) return localMessage;
        const version = Number(args?.version);
        if (!Number.isInteger(version) || version < 1) {
          return "Error: version must be a positive integer.";
        }
        const detail = await getExtensionHistoryVersion(id, version);
        if (!detail) {
          return `Error: extension history version not found: ${id}#${version}`;
        }
        return { ok: true, ...detail };
      },
      readOnly: true,
    },

    "create-extension": {
      tool: {
        description:
          'Create a sandboxed Alpine.js mini-app extension. Use this when the user asks to create, build, or make an extension/widget/dashboard/calculator. Call this action exactly once per requested extension. The content must be a self-contained Alpine.js HTML body snippet that can use appAction(), appFetch(), dbQuery(), dbExec(), extensionFetch(), and extensionData. IMPORTANT — hosting a pasted file: if the user pasted a large HTML/Alpine file (it appears in your context as an <attachment name="pasted-text-…"> block) and asked you to host it as-is, do NOT copy that file into `content`. Instead leave `content` empty and pass `contentFromAttachment` set to that attachment\'s name (or the literal "latest" for the most recent pasted block) — the server reads the file verbatim. Re-emitting a large pasted file as `content` regularly gets cut off mid-stream and stalls the turn. Prefer appAction(name, params) for app data and actions, including read actions mounted as GET; do not call template /api/* routes from appFetch because the extension bridge only allows framework /_agent-native/* paths. Parse JSON string action results before aggregating; use dbQuery()/dbExec() only for known existing SQL tables. Keep the initial create-extension payload compact and working; for complex extensions, create a useful v1 first, then use focused update-extension edits for refinements rather than assembling one enormous tool input. For any non-trivial component (more than a couple of state fields, any methods, any string formatting, any branching) put the component in a <script> block via Alpine.data(\'name\', () => ({...})) and reference it with x-data="name" — do NOT cram methods, template literals, or branching logic into an inline x-data="{...}" attribute (HTML parser pitfalls cause ReferenceError failures). Define every variable referenced from x-text/x-show/x-if/x-for on the data object\'s initial state. If the extension\'s value depends on an LLM call, require a real key via \\${keys.OPENAI_API_KEY}/\\${keys.ANTHROPIC_API_KEY} (and tell the user to add it in the Dispatch Vault, or in app Settings → API Keys & Connections for standalone apps, if missing) or route the AI work to the agent chat — never ship a stubbed analysis step that renders a placeholder/boolean as the result.',
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
                "Self-contained Alpine.js HTML body snippet. The iframe canvas already has modest default padding, so avoid duplicate outer padding unless the design needs it. Use semantic Tailwind colors (bg-background, text-foreground, bg-primary, etc.) for native theming. Do not include a full app build, React code, or source files. Required UNLESS you pass contentFromAttachment instead.",
            },
            contentFromAttachment: {
              type: "string",
              description:
                'Host a pasted/attached file verbatim WITHOUT re-typing it. Set this to the name of an attachment on the current turn (e.g. "pasted-text-1718000000000-ab12cd.txt") or the literal "latest" for the most recent pasted block; the server resolves it into the extension content. Use this instead of `content` whenever the user pasted a large file to host — it avoids re-emitting thousands of tokens. When set, leave `content` empty.',
            },
            icon: {
              type: "string",
              description: "Optional icon name or short label.",
            },
          },
          required: ["name"],
        },
      },
      run: async (args, ctx) => {
        const name = String(args?.name ?? "").trim();
        if (!name) return "Error: name is required.";
        const resolved = resolveExtensionContent(args, ctx);
        if ("error" in resolved) return resolved.error;
        const content = resolved.content.trim();
        if (!content) return "Error: content is required.";
        const description = String(args?.description ?? "").trim();
        const icon = args?.icon ? String(args.icon) : undefined;

        // Idempotency: if an identical extension was created in the last 5
        // minutes (e.g. a connection drop caused the agent to retry this tool
        // call), return the existing one instead of creating a duplicate.
        // Keyed on the FULL create inputs (name + content + description + icon),
        // so two creates that differ in ANY of them are treated as distinct
        // rather than silently collapsed — only a byte-identical re-create (the
        // retry case) recovers the existing row.
        const existing = await findRecentDuplicateExtension({
          name,
          content,
          description,
          icon,
        });
        if (existing) {
          const existingPath = extensionPath(existing.id, existing.name);
          try {
            await writeAppState("navigate", {
              view: "extensions",
              extensionId: existing.id,
              path: existingPath,
              _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            });
          } catch {
            // Non-fatal — agent can still mention the path in its reply.
          }
          return {
            ok: true,
            extension: { ...existing, path: existingPath },
            path: existingPath,
            next: `Extension was already created in this session (recovered from a connection retry). The user is being navigated to it — no further navigation tool calls needed.`,
          };
        }

        const extension = await createExtension({
          name,
          description,
          content,
          icon,
        });
        const path = extensionPath(extension.id, extension.name);

        // Auto-navigate so the user lands on the new extension instead of
        // having to read the JSON response and click a link. Writes a
        // one-shot `navigate` app-state command the UI consumes and clears.
        try {
          await writeAppState("navigate", {
            view: "extensions",
            extensionId: extension.id,
            path,
            // Unique-per-write token so the UI's `use-navigation-state` hook
            // can dedup race-driven re-reads of the same command.
            _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          });
        } catch {
          // Non-fatal — agent can still mention the path in its reply.
        }

        return {
          ok: true,
          extension: { ...extension, path },
          path,
          next: `Created. The user is being navigated to the new extension automatically — no further navigation tool calls needed.`,
        };
      },
    },

    "update-extension": {
      tool: {
        description:
          'Update an existing sandboxed Alpine.js mini-app extension. If the user is viewing the extension, use the extensionId from <current-screen> or <current-url> directly; do not list extensions first just to find the current id. Prefer granular edits for surgical changes; use full content replacement only for broad rewrites. Supported edits include literal replace, insert-before/after marker, replace-between markers, replace-section/wrap-section/remove-section for <!-- agent-native:section name --> blocks, and regex-replace. Pass format=true to run Prettier on the final HTML. To replace the whole body with a large pasted file, pass contentFromAttachment (the attachment name, or "latest") instead of copying the file into `content` — that avoids re-emitting thousands of tokens.',
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Extension id to update. Prefer the extensionId from <current-screen> or <current-url> for the current extension.",
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
            contentFromAttachment: {
              type: "string",
              description:
                'Optional full replacement sourced from a pasted/attached file on the current turn, by attachment name (or the literal "latest" for the most recent pasted block). Use instead of `content` when replacing the whole body with a large pasted file so you do not have to re-type it. Ignored when `content` is provided.',
            },
            patches: {
              type: "string",
              description:
                'Legacy optional JSON array of { "find": "...", "replace": "...", "all"?: true, "expectedMatches"?: 1, "required"?: true } patches. Missing required targets fail instead of silently no-oping.',
            },
            edits: {
              type: "string",
              description:
                'Preferred optional JSON array of granular edit operations. Examples: { "op": "insert-after", "marker": "<!-- section:metrics -->", "content": "..." }, { "op": "replace-section", "section": "npm-chart", "content": "..." }, { "op": "wrap-section", "section": "charts", "before": "<div>", "after": "</div>" }, { "op": "regex-replace", "pattern": "...", "replace": "...", "expectedMatches": 1 }.',
            },
            format: {
              type: "boolean",
              description:
                "When true, format the final extension HTML with Prettier after applying content, patches, and edits.",
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
      run: async (args, ctx) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const localMessage = await localExtensionEditMessage(id);
        if (localMessage) return localMessage;

        // Full-replacement content can come inline (`content`) or by reference
        // (`contentFromAttachment`) so the model never has to re-type a large
        // pasted file. Inline wins only when NON-EMPTY — the docstring tells
        // callers to leave `content` empty when using `contentFromAttachment`,
        // so an empty/blank `content` must fall through to the attachment
        // instead of blanking the extension (mirrors resolveExtensionContent).
        let replacementContent =
          typeof args?.content === "string" && args.content.trim().length > 0
            ? args.content
            : undefined;
        if (
          replacementContent === undefined &&
          args?.contentFromAttachment !== undefined
        ) {
          const resolved = resolveExtensionContent(args, ctx);
          if ("error" in resolved) return resolved.error;
          replacementContent = resolved.content;
        }

        let result = null;
        const hasContentUpdate =
          replacementContent !== undefined ||
          args?.patches !== undefined ||
          args?.edits !== undefined ||
          args?.format !== undefined;
        if (hasContentUpdate) {
          const patches = parsePatches((args as any).patches);
          if (args?.patches !== undefined && !patches) {
            return "Error: patches must be a JSON array of { find, replace } objects.";
          }
          const edits = parseEdits((args as any).edits);
          if (args?.edits !== undefined && !edits) {
            return "Error: edits must be a JSON array of supported extension edit operations.";
          }
          result = await updateExtensionContent(id, {
            content: replacementContent,
            patches,
            edits,
            format: coerceBoolean(args?.format),
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
        const hiddenIds = await getHiddenExtensionIdsForCurrentUser();
        return {
          ok: true,
          extension: await summarizeExtension(result, hiddenIds, false),
        };
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
        const localMessage = await localExtensionEditMessage(id);
        if (localMessage) return localMessage;
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

    "restore-extension-history-version": {
      tool: {
        description:
          "Restore an extension's name, description, icon, and HTML content from a saved history version. Requires editor access. This does not restore sharing visibility or ownership.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Extension id to restore.",
            },
            version: {
              type: "number",
              description:
                "Saved history version number to restore. Use list-extension-history first if unsure.",
            },
          },
          required: ["id", "version"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const localMessage = await localExtensionReadonlyHistoryMessage(id);
        if (localMessage) return localMessage;
        const version = Number(args?.version);
        if (!Number.isInteger(version) || version < 1) {
          return "Error: version must be a positive integer.";
        }
        const result = await restoreExtensionHistoryVersion(id, version);
        if (!result) {
          return `Error: extension history version not found: ${id}#${version}`;
        }
        const hiddenIds = await getHiddenExtensionIdsForCurrentUser();
        return {
          ok: true,
          restoredVersion: version,
          extension: await summarizeExtension(result, hiddenIds, false),
        };
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
        const localMessage = await localExtensionEditMessage(id);
        if (localMessage) return localMessage;
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
        const localMessage = await localExtensionEditMessage(id);
        if (localMessage) return localMessage;
        await unhideExtension(id);
        return { ok: true, id };
      },
    },

    "global-hide-extension": {
      tool: {
        description:
          "Globally hide an extension from EVERYONE's Extensions list/sidebar (not just the current user) by stamping it hidden. Requires owner/admin access. Use this for an admin takedown of a shared/org extension. The extension is not deleted and stays accessible by id; use global-unhide-extension to reverse. For removing an extension only from your own view, use hide-extension instead.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Extension id to hide for everyone. Use list-extensions first if you only know the display name.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const localMessage = await localExtensionEditMessage(id);
        if (localMessage) return localMessage;
        const extension = await getExtension(id);
        if (!extension) return `Error: extension not found: ${id}`;

        await globalHideExtension(id);
        return {
          ok: true,
          globallyHidden: summarizeDeletedExtension(extension),
        };
      },
    },

    "global-unhide-extension": {
      tool: {
        description:
          "Reverse a global hide so the extension reappears in everyone's Extensions list/sidebar again. Requires owner/admin access. Use list-extensions with includeGloballyHidden=true to find globally-hidden ids.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Extension id to unhide for everyone.",
            },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args?.id ?? "").trim();
        if (!id) return "Error: id is required.";
        const localMessage = await localExtensionEditMessage(id);
        if (localMessage) return localMessage;
        await globalUnhideExtension(id);
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
        const localMessage = await localExtensionEditMessage(extensionId);
        if (localMessage) return localMessage;
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
        const localMessage = await localExtensionEditMessage(extensionId);
        if (localMessage) return localMessage;
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
        const localMessage = await localExtensionEditMessage(extensionId);
        if (localMessage) return localMessage;
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
  row: ExtensionRow | LocalExtensionRow,
  hiddenIds: Set<string>,
  includeContent: boolean,
) {
  const local = isLocalExtensionRow(row);
  const access = local
    ? ({ role: "viewer" } as const)
    : await resolveAccess("extension", row.id).catch(() => null);
  return {
    id: row.id,
    name: row.name,
    path: extensionPath(row.id, row.name),
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
    globallyHidden: row.hiddenAt != null,
    hiddenAt: row.hiddenAt,
    hiddenBy: row.hiddenBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(local ? { source: row.source } : {}),
    ...(includeContent ? { content: row.content } : {}),
  };
}

async function localExtensionEditMessage(id: string): Promise<string | null> {
  const localExtension = await getLocalExtension(id);
  if (!localExtension) return null;
  return `Error: extension "${id}" is backed by local files at ${localExtension.source.entryPath}. Edit that file or ${localExtension.source.manifestPath} in the workspace instead of using SQL-backed extension actions.`;
}

async function localExtensionReadonlyHistoryMessage(
  id: string,
): Promise<string | null> {
  const localExtension = await getLocalExtension(id);
  if (!localExtension) return null;
  return `Error: extension "${id}" is backed by local files at ${localExtension.source.entryPath}. Use Git or your editor's file history for versions.`;
}

function summarizeDeletedExtension(row: ExtensionRow) {
  return {
    id: row.id,
    name: row.name,
    ownerEmail: row.ownerEmail,
    visibility: row.visibility,
  };
}

/**
 * Filename prefix the composer stamps on a "Pasted text" attachment chip
 * (`createPastedTextFile` in `client/composer/pasted-text.ts`). The agent sees
 * these as `<attachment name="pasted-text-…">` blocks, so a model hosting a
 * pasted file can reference it by that name via `contentFromAttachment`.
 */
const PASTED_TEXT_ATTACHMENT_PREFIX = "pasted-text-";

/** Keyword refs that mean "use the most recent pasted block above". */
const LATEST_ATTACHMENT_KEYWORDS = new Set([
  "latest",
  "last",
  "paste",
  "pasted",
  "pasted-text",
  "attachment",
  "above",
]);

/** Strip the `<attachment …>\n…\n</attachment>` wrapper if one is present. */
function unwrapAttachmentEnvelope(text: string): string {
  const match = text.match(/^<attachment\b[^>]*>\n([\s\S]*)\n<\/attachment>$/);
  return match ? match[1] : text;
}

/**
 * Resolve the HTML body for create/update-extension from either the inline
 * `content` argument or a `contentFromAttachment` handle pointing at a pasted /
 * uploaded text attachment on the current turn. The by-reference path lets the
 * model host a large pasted file without re-emitting it as a tool argument —
 * which frequently gets cut off mid-stream and triggers a continuation loop.
 *
 * Resolution is forgiving: an exact attachment-name match wins, then a keyword
 * ("latest"/"pasted"/…) or a near-miss name falls back to the most recent
 * pasted-text attachment (or the only text attachment).
 */
function resolveExtensionContent(
  args: Record<string, string> | undefined,
  ctx: ActionRunContext | undefined,
): { content: string } | { error: string } {
  const inline = args?.content !== undefined ? String(args.content) : undefined;
  if (inline !== undefined && inline.trim().length > 0) {
    return { content: inline };
  }

  const ref =
    args?.contentFromAttachment !== undefined
      ? String(args.contentFromAttachment).trim()
      : "";
  if (!ref) {
    return {
      error:
        "Error: provide either content (inline Alpine.js HTML) or contentFromAttachment (the name of a pasted/attached file to host verbatim).",
    };
  }

  const textAttachments = (ctx?.attachments ?? []).filter(
    (att): att is AgentChatAttachment & { text: string } =>
      typeof att.text === "string" && att.text.trim().length > 0,
  );
  if (textAttachments.length === 0) {
    return {
      error:
        "Error: contentFromAttachment was set but this turn has no readable text attachment. Re-send the file as an attachment, or pass the HTML inline via content.",
    };
  }

  const lower = ref.toLowerCase();
  let match = textAttachments.find(
    (att) => (att.name ?? "").trim().toLowerCase() === lower,
  );
  if (!match) {
    const pasted = textAttachments.filter((att) =>
      (att.name ?? "").startsWith(PASTED_TEXT_ATTACHMENT_PREFIX),
    );
    const pool = pasted.length > 0 ? pasted : textAttachments;
    if (
      LATEST_ATTACHMENT_KEYWORDS.has(lower) ||
      pasted.length === 1 ||
      textAttachments.length === 1
    ) {
      match = pool[pool.length - 1];
    }
  }

  if (!match) {
    const names = textAttachments
      .map((att) => att.name || "(unnamed)")
      .join(", ");
    return {
      error: `Error: no attachment matched contentFromAttachment="${ref}". Available text attachments: ${names}. Pass one of those names exactly, or "latest" for the most recent pasted block.`,
    };
  }

  const resolved = unwrapAttachmentEnvelope(match.text);
  // Fail fast instead of hosting corrupted content. The client caps an
  // outbound attachment at MAX_OUTBOUND_ATTACHMENT_CHARS (200k) and appends a
  // trailing notice ending "...omitted from the submitted attachment.]" (see
  // truncateOutboundAttachment in agent-chat-adapter.ts). Hosting that verbatim
  // would bake a half file + the notice into the extension body; reject it with
  // an actionable message so the user shrinks/splits the file instead.
  if (/omitted from the submitted attachment\.\]\s*$/.test(resolved)) {
    return {
      error:
        "Error: the pasted file is too large to host verbatim (it was truncated above 200,000 characters before reaching the server, so hosting it would corrupt the extension). Reduce the file or split it into smaller extensions, then try again.",
    };
  }
  return { content: resolved };
}

function coerceBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function coerceLimit(value: unknown): number {
  const limit = Number(value ?? 100);
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(1, Math.floor(limit)), 500);
}

function parsePatches(value: unknown): ExtensionLegacyPatch[] | undefined {
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

function parseEdits(value: unknown): ExtensionContentEdit[] | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return undefined;
  return parsed.every(isValidContentEdit)
    ? (parsed as ExtensionContentEdit[])
    : undefined;
}

function isValidContentEdit(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const edit = value as Record<string, unknown>;
  const op = edit.op ?? "replace";
  if (typeof op !== "string") return false;

  switch (op) {
    case "replace":
      return typeof edit.find === "string" && typeof edit.replace === "string";
    case "insert-before":
    case "insert-after":
      return (
        typeof edit.marker === "string" && typeof edit.content === "string"
      );
    case "replace-between":
      return (
        typeof edit.start === "string" &&
        typeof edit.end === "string" &&
        typeof edit.content === "string"
      );
    case "replace-section":
      return (
        typeof edit.section === "string" && typeof edit.content === "string"
      );
    case "wrap-section":
      return (
        typeof edit.section === "string" &&
        typeof edit.before === "string" &&
        typeof edit.after === "string"
      );
    case "remove-section":
      return typeof edit.section === "string";
    case "regex-replace":
      return (
        typeof edit.pattern === "string" && typeof edit.replace === "string"
      );
    default:
      return false;
  }
}
