/**
 * Actions exposed for the data-programs primitive: save/preview/run/list/get/
 * delete. Mirrors the repo's `defineAction` conventions (see
 * `../mcp/actions/create-org-service-token.ts`, `../sharing/actions/*`).
 *
 * Security: every action that EXECUTES code (save — which dry-runs before
 * persisting — preview, run) or MUTATES stored code (delete) is
 * `toolCallable: false`, so the sandboxed tools-iframe bridge can never
 * invoke stored/arbitrary code under the opener's session — the same
 * rationale as `provider-api-request`. `list`/`get` are read-only and
 * access-scoped through the sharing helpers.
 */

import { z } from "zod";

import { defineAction } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { hashDataProgramParams, runDataProgram } from "./execute.js";
import {
  archiveDataProgram,
  getDataProgram,
  getLatestRun,
  listDataPrograms,
  upsertDataProgram,
  MIN_REFRESH_TTL_MS,
} from "./store.js";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

const paramsRecord = z.record(z.string(), z.unknown()).optional();

function compactColumns(
  schema: { name: string; type: string }[] | undefined,
): { name: string; type: string }[] {
  return schema ?? [];
}

export interface CreateDataProgramActionsOptions {
  appId: string;
  getActions: () => Record<string, ActionEntry>;
}

export function createDataProgramActions(
  options: CreateDataProgramActionsOptions,
): Record<string, ActionEntry> {
  const { appId } = options;

  const saveDataProgram = defineAction({
    description:
      "Save (create or update, by name) a data program: a stored JS script that fetches/joins/aggregates provider or app data server-side and emits rows for dashboard panels. " +
      "Dry-runs the code with defaultParams before persisting and rejects the save if it fails, so a broken program is never stored.",
    schema: z.object({
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(
          SLUG_RE,
          "name must be a slug: lowercase letters, numbers, - or _",
        )
        .describe(
          "Stable slug identifying this program, unique per your account.",
        ),
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      code: z
        .string()
        .min(1)
        .describe(
          "JS source. Must call emit(rows, schema?) exactly once. Has access to the same globals as run-code (providerFetch, providerFetchAll, providerSearchAll, appAction, workspace*) plus a frozen `params` global.",
        ),
      paramsSchema: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional JSON Schema describing accepted params."),
      defaultParams: paramsRecord,
      refreshMode: z.enum(["manual", "ttl"]).optional(),
      refreshTtlMs: z
        .number()
        .int()
        .min(MIN_REFRESH_TTL_MS)
        .optional()
        .describe(`Minimum ${MIN_REFRESH_TTL_MS}ms.`),
      background: z.boolean().optional(),
    }),
    toolCallable: false,
    run: async (args, ctx) => {
      const userEmail = ctx?.userEmail;
      if (!userEmail)
        throw new Error("No authenticated user for save-data-program.");

      const dryRun = await runDataProgram({
        code: args.code,
        params: args.defaultParams ?? {},
        ctx: { userEmail, orgId: ctx?.orgId ?? null },
        triggeredBy: "preview",
      });
      if (!dryRun.ok) {
        throw new Error(
          `Dry-run failed (${dryRun.error.code}): ${dryRun.error.message}`,
        );
      }

      const program = await upsertDataProgram({
        appId,
        name: args.name,
        title: args.title,
        description: args.description ?? "",
        code: args.code,
        paramsSchema: args.paramsSchema
          ? JSON.stringify(args.paramsSchema)
          : null,
        defaultParams: args.defaultParams
          ? JSON.stringify(args.defaultParams)
          : null,
        outputColumns: JSON.stringify(dryRun.schema),
        refreshMode: args.refreshMode,
        refreshTtlMs: args.refreshTtlMs,
        background: args.background,
        ownerEmail: userEmail,
        orgId: ctx?.orgId ?? null,
      });

      return {
        programId: program.id,
        rowCount: dryRun.rows.length,
        columns: compactColumns(dryRun.schema),
        sampleRows: dryRun.rows.slice(0, 5),
      };
    },
  });

  const previewDataProgram = defineAction({
    description:
      "Dry-run a data-program script WITHOUT saving it. Use this to iterate on a program before calling save-data-program.",
    schema: z.object({
      code: z.string().min(1),
      params: paramsRecord,
    }),
    toolCallable: false,
    run: async (args, ctx) => {
      const result = await runDataProgram({
        code: args.code,
        params: args.params ?? {},
        ctx: { userEmail: ctx?.userEmail, orgId: ctx?.orgId ?? null },
        triggeredBy: "preview",
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
        };
      }
      return {
        ok: true,
        rowCount: result.rows.length,
        columns: compactColumns(result.schema),
        sampleRows: result.rows.slice(0, 5),
      };
    },
  });

  const runDataProgramAction = defineAction({
    description:
      "Run a saved data program and return a compact proof of the result (row count, columns, sample rows). Set includeRows to get the full (capped) row set.",
    schema: z.object({
      programId: z.string().min(1),
      params: paramsRecord,
      forceRefresh: z.boolean().optional(),
      includeRows: z.boolean().optional(),
    }),
    toolCallable: false,
    run: async (args, ctx) => {
      const result = await runDataProgram({
        programId: args.programId,
        appId,
        params: args.params ?? {},
        ctx: { userEmail: ctx?.userEmail, orgId: ctx?.orgId ?? null },
        triggeredBy: "agent",
        forceRefresh: args.forceRefresh,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          ...(result.lastGoodRun
            ? {
                lastGoodRun: {
                  rowCount: result.lastGoodRun.rows.length,
                  columns: compactColumns(result.lastGoodRun.schema),
                  sampleRows: result.lastGoodRun.rows.slice(0, 5),
                  truncated: result.lastGoodRun.truncated,
                  asOfMs: result.lastGoodRun.asOfMs,
                },
              }
            : {}),
        };
      }
      return {
        ok: true,
        rowCount: result.rows.length,
        columns: compactColumns(result.schema),
        sampleRows: result.rows.slice(0, 5),
        ...(args.includeRows ? { rows: result.rows } : {}),
        asOfMs: result.asOfMs,
        cacheHit: result.cacheHit,
        stale: result.stale,
        truncated: result.truncated,
      };
    },
  });

  const listDataProgramsAction = defineAction({
    description:
      "List data programs for this app, scoped to what the caller can access.",
    schema: z.object({
      includeArchived: z.boolean().optional(),
    }),
    http: { method: "GET" },
    readOnly: true,
    run: async (args, ctx) => {
      const programs = await listDataPrograms(
        appId,
        { userEmail: ctx?.userEmail, orgId: ctx?.orgId ?? undefined },
        { includeArchived: args.includeArchived },
      );
      return {
        programs: programs.map((p) => ({
          id: p.id,
          name: p.name,
          title: p.title,
          description: p.description,
          refreshMode: p.refreshMode,
          refreshTtlMs: p.refreshTtlMs,
          background: p.background,
          archivedAt: p.archivedAt,
          updatedAt: p.updatedAt,
          columns: p.outputColumns ? JSON.parse(p.outputColumns) : [],
        })),
      };
    },
  });

  const getDataProgramAction = defineAction({
    description:
      "Get one data program's metadata, code, and last-run summary. Set includeRows to include the last run's cached rows.",
    schema: z.object({
      programId: z.string().min(1),
      includeRows: z.boolean().optional(),
    }),
    http: { method: "GET" },
    readOnly: true,
    run: async (args, ctx) => {
      const program = await getDataProgram(args.programId, appId);
      if (!program) throw new Error("Data program not found.");

      const { resolveAccess } = await import("../sharing/access.js");
      const access = await resolveAccess("data_program", args.programId, {
        userEmail: ctx?.userEmail,
        orgId: ctx?.orgId ?? undefined,
      });
      if (!access) throw new Error("Access denied to this data program.");

      const defaultParams = program.defaultParams
        ? (JSON.parse(program.defaultParams) as Record<string, unknown>)
        : {};
      // Viewer/org-scoped hash: the cached run for these params was produced
      // under SOME caller's credentials and org grants, so only show it back
      // to that same scope (see hashDataProgramParams doc).
      const hash = hashDataProgramParams(
        defaultParams,
        ctx?.userEmail,
        ctx?.orgId ?? null,
      );
      const lastRun = await getLatestRun(program.id, hash);

      return {
        id: program.id,
        name: program.name,
        title: program.title,
        description: program.description,
        code: program.code,
        paramsSchema: program.paramsSchema
          ? JSON.parse(program.paramsSchema)
          : null,
        defaultParams,
        refreshMode: program.refreshMode,
        refreshTtlMs: program.refreshTtlMs,
        background: program.background,
        archivedAt: program.archivedAt,
        columns: program.outputColumns ? JSON.parse(program.outputColumns) : [],
        lastRun: lastRun
          ? {
              status: lastRun.status,
              rowCount: lastRun.rowCount,
              truncated: lastRun.truncated,
              errorCode: lastRun.errorCode,
              errorMessage: lastRun.errorMessage,
              finishedAt: lastRun.finishedAt,
              ...(args.includeRows && lastRun.rowsJson
                ? { rows: JSON.parse(lastRun.rowsJson) }
                : {}),
            }
          : null,
      };
    },
  });

  const deleteDataProgramAction = defineAction({
    description:
      "Archive (soft-delete) a data program. Existing dashboard panels referencing it will show an archived error until repointed.",
    schema: z.object({
      programId: z.string().min(1),
    }),
    toolCallable: false,
    run: async (args, ctx) => {
      const { assertAccess } = await import("../sharing/access.js");
      await assertAccess("data_program", args.programId, "editor", {
        userEmail: ctx?.userEmail,
        orgId: ctx?.orgId ?? undefined,
      });
      const archived = await archiveDataProgram(args.programId, appId);
      return { archived };
    },
  });

  return {
    "save-data-program": saveDataProgram as unknown as ActionEntry,
    "preview-data-program": previewDataProgram as unknown as ActionEntry,
    "run-data-program": runDataProgramAction as unknown as ActionEntry,
    "list-data-programs": listDataProgramsAction as unknown as ActionEntry,
    "get-data-program": getDataProgramAction as unknown as ActionEntry,
    "delete-data-program": deleteDataProgramAction as unknown as ActionEntry,
  };
}
