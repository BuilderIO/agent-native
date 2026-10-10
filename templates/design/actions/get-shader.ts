import { defineAction, fail } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { nativeEffectAnimationCapability } from "../shared/native-effect-animation-capability.js";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_PRESETS,
} from "../shared/native-effect-presets.js";
import {
  hashEffectDefinition,
  NativeEffectApprovalStateError,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";
import {
  inspectNativeEffectHtml,
  parseEffectsFromHtml,
  validateEffectDocument,
  type EffectDefinition,
} from "../shared/native-effects.js";
import {
  decodeNativeShaderLibraryCursor,
  encodeNativeShaderLibraryCursor,
  NativeShaderLibraryCursorError,
} from "../shared/native-shader-library.js";

function summarizeNativeDefinition(definition: EffectDefinition) {
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    kind: definition.kind,
    animationCapability: nativeEffectAnimationCapability(definition),
    placements: definition.placements,
    properties: definition.properties,
    inputs: definition.inputs ?? null,
    outputs: definition.outputs ?? null,
    resources: definition.resources ?? null,
    output: definition.output ?? null,
    sourceSizing: definition.sourceSizing ?? null,
    passes: definition.passes.map((pass) => ({
      id: pass.id,
      kind: pass.kind,
      reads: pass.reads,
      output: pass.output,
      persistent: pass.persistent ?? false,
      previousFrameReads: pass.previousFrameReads ?? [],
    })),
  };
}

function queryObject<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return z.union([
    schema,
    z
      .string()
      .max(2_048)
      .transform((value, ctx): unknown => {
        try {
          return JSON.parse(value);
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Invalid JSON query object.",
          });
          return z.NEVER;
        }
      })
      .pipe(schema),
  ]);
}

const sourceSchema = z.object({
  kind: z.enum(["design-file", "inline-html"]).default("design-file"),
  designId: z.string().optional(),
  fileId: z.string().optional(),
  path: z.string().optional(),
});

const targetSchema = z.object({
  nodeId: z.string().optional(),
  selector: z.string().optional(),
});

function parseLibraryPlacements(value: string | null): string[] {
  try {
    if (value === null) throw new TypeError("Missing placements metadata");
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length >= 1 &&
      parsed.length <= 3 &&
      parsed.every((placement) =>
        ["fill", "layer", "backdrop"].includes(placement),
      )
    )
      return parsed;
  } catch {
    fail("Shader Library metadata is unreadable.", {
      errorCode: "native_shader_library_unreadable",
      statusCode: 422,
    });
  }
  fail("Shader Library metadata is unreadable.", {
    errorCode: "native_shader_library_unreadable",
    statusCode: 422,
  });
}

export default defineAction({
  description:
    "Discover registered native shader definitions, presets, exact versions, approvals, and the selected Design file manifest. " +
    "format=native-v2 is the default. format=legacy only describes saved historical shader descriptors; " +
    "it does not enable applying or previewing retired shader implementations." +
    " Definition summaries report animationCapability; static versions do not respond to instance timing.speed.",
  http: { method: "GET" },
  schema: z.object({
    format: z.enum(["legacy", "native-v2"]).optional().default("native-v2"),
    definitionId: z.string().optional(),
    definitionVersion: z
      .union([
        z.number().int().positive(),
        z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .pipe(z.number().int().positive()),
      ])
      .optional(),
    includeSource: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .optional()
      .default(false),
    includeLibrary: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .optional()
      .default(false),
    libraryEntryId: z.string().max(128).optional(),
    libraryCursor: z.string().max(512).optional(),
    libraryLimit: z
      .union([
        z.number().int().min(1).max(50),
        z
          .string()
          .regex(/^[1-9]\d?$/)
          .transform(Number)
          .pipe(z.number().int().min(1).max(50)),
      ])
      .optional()
      .default(24),
    librarySearch: z.string().trim().max(100).optional(),
    libraryCategory: z
      .enum(["generator", "processor", "simulation"])
      .optional(),
    libraryView: z
      .enum(["all", "favorites", "recent"])
      .optional()
      .default("all"),
    source: queryObject(sourceSchema)
      .optional()
      .describe(
        "Optional design source context. When provided, the instructions are tailored to the source kind.",
      ),
    target: queryObject(targetSchema)
      .optional()
      .describe(
        "Optional target element. When provided, the inspection hint is scoped to that element.",
      ),
  }),
  readOnly: true,
  run: async ({
    format,
    source,
    target,
    definitionId,
    definitionVersion,
    includeSource,
    includeLibrary,
    libraryEntryId,
    libraryCursor,
    libraryLimit,
    librarySearch,
    libraryCategory,
    libraryView,
  }) => {
    if (format === "native-v2") {
      if (target?.selector)
        fail(
          "Native shader selectors are unsupported; use an authored nodeId.",
          {
            errorCode: "native_effect_selector_unsupported",
            statusCode: 400,
          },
        );
      if (
        includeSource &&
        !libraryEntryId &&
        (!definitionId || !definitionVersion)
      )
        fail(
          "includeSource requires an exact definitionId and definitionVersion.",
          {
            errorCode: "native_effect_definition_version_required",
            statusCode: 400,
          },
        );
      if (!source && target?.nodeId)
        fail("A design-file source is required to inspect a node.", {
          errorCode: "native_effect_target_requires_source",
          statusCode: 400,
        });
      if (libraryEntryId && !includeLibrary)
        fail("includeLibrary is required for an exact Library entry read.", {
          errorCode: "native_shader_library_request_invalid",
          statusCode: 400,
        });
      if (libraryEntryId && !includeSource)
        fail("An exact Library entry read requires includeSource=true.", {
          errorCode: "native_shader_library_request_invalid",
          statusCode: 400,
        });
      let library = null;
      if (includeLibrary) {
        const ownerEmail = getRequestUserEmail()?.trim().toLowerCase();
        if (!ownerEmail)
          fail("Sign in to read your Shader Library.", {
            errorCode: "native_shader_library_auth_required",
            statusCode: 401,
          });
        const db = getDb();
        const activityTable = schema.nativeShaderLibraryActivity;
        const updated = sql<string>`coalesce(${schema.nativeShaderLibrary.updatedAt}, ${schema.nativeShaderLibrary.createdAt}, '')`;
        const sortAt =
          libraryView === "recent"
            ? sql<string>`coalesce(${activityTable.lastUsedAt}, '')`
            : updated;
        let cursor = null;
        if (libraryCursor) {
          try {
            cursor = decodeNativeShaderLibraryCursor(libraryCursor, {
              view: libraryView,
              search: librarySearch ?? "",
              category: libraryCategory ?? null,
            });
          } catch (error) {
            if (!(error instanceof NativeShaderLibraryCursorError)) throw error;
            fail(error.message, {
              errorCode: "native_shader_library_cursor_invalid",
              statusCode: 400,
            });
          }
        }
        const rows = await db
          .select({
            id: schema.nativeShaderLibrary.id,
            name: schema.nativeShaderLibrary.name,
            description: schema.nativeShaderLibrary.description,
            category: schema.nativeShaderLibrary.category,
            definitionId: schema.nativeShaderLibrary.definitionId,
            definitionVersion: schema.nativeShaderLibrary.definitionVersion,
            executionHash: schema.nativeShaderLibrary.executionHash,
            kind: schema.nativeShaderLibrary.kind,
            placements: schema.nativeShaderLibrary.placements,
            presetPlacement: schema.nativeShaderLibrary.presetPlacement,
            propertyCount: schema.nativeShaderLibrary.propertyCount,
            passCount: schema.nativeShaderLibrary.passCount,
            thumbnailHandle: schema.nativeShaderLibrary.thumbnailHandle,
            createdAt: schema.nativeShaderLibrary.createdAt,
            updatedAt: schema.nativeShaderLibrary.updatedAt,
            sortAt,
            favorite: activityTable.favorite,
            lastUsedAt: activityTable.lastUsedAt,
          })
          .from(schema.nativeShaderLibrary)
          .leftJoin(
            activityTable,
            and(
              eq(activityTable.ownerEmail, ownerEmail),
              eq(
                activityTable.itemKey,
                sql<string>`'library:' || ${schema.nativeShaderLibrary.id}`,
              ),
            ),
          )
          .where(
            and(
              eq(schema.nativeShaderLibrary.ownerEmail, ownerEmail),
              libraryView === "favorites"
                ? eq(activityTable.favorite, true)
                : undefined,
              libraryView === "recent"
                ? isNotNull(activityTable.lastUsedAt)
                : undefined,
              libraryCategory
                ? eq(schema.nativeShaderLibrary.category, libraryCategory)
                : undefined,
              librarySearch
                ? ilike(
                    schema.nativeShaderLibrary.name,
                    `%${librarySearch.replace(/[\\%_]/g, "\\$&")}%`,
                  )
                : undefined,
              cursor
                ? or(
                    lt(sortAt, cursor.sortAt),
                    and(
                      eq(sortAt, cursor.sortAt),
                      lt(schema.nativeShaderLibrary.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(sortAt), desc(schema.nativeShaderLibrary.id))
          .limit(libraryLimit + 1);
        const page = rows.slice(0, libraryLimit);
        if (
          page.some(
            (row) =>
              !["generator", "processor", "simulation"].includes(
                row.kind ?? "",
              ) ||
              row.placements === null ||
              !["fill", "layer", "backdrop"].includes(
                row.presetPlacement ?? "",
              ) ||
              row.propertyCount === null ||
              row.propertyCount < 0 ||
              row.passCount === null ||
              row.passCount < 1,
          )
        )
          fail("Shader Library metadata is unreadable.", {
            errorCode: "native_shader_library_unreadable",
            statusCode: 422,
          });
        let selectedEntry = null;
        if (libraryEntryId && includeSource) {
          const [stored] = await db
            .select({
              definitionJson: schema.nativeShaderLibrary.definitionJson,
              presetJson: schema.nativeShaderLibrary.presetJson,
              executionHash: schema.nativeShaderLibrary.executionHash,
            })
            .from(schema.nativeShaderLibrary)
            .where(
              and(
                eq(schema.nativeShaderLibrary.id, libraryEntryId),
                eq(schema.nativeShaderLibrary.ownerEmail, ownerEmail),
              ),
            )
            .limit(1);
          if (!stored)
            fail("Shader Library entry not found.", {
              errorCode: "native_shader_library_not_found",
              statusCode: 404,
            });
          let definitionValue: unknown;
          let presetValue: unknown;
          try {
            definitionValue = JSON.parse(stored.definitionJson);
            presetValue = JSON.parse(stored.presetJson);
          } catch {
            fail("Shader Library source is unreadable.", {
              errorCode: "native_shader_library_unreadable",
              statusCode: 422,
            });
          }
          const checked = validateEffectDocument({
            schemaVersion: 2,
            definitions: [definitionValue],
            instances: [],
            presets: [presetValue],
          });
          if (
            !checked.valid ||
            !checked.document ||
            (await hashEffectDefinition(checked.document.definitions[0])) !==
              stored.executionHash
          )
            fail(
              "Shader Library source failed validation or hash verification.",
              {
                errorCode: "native_shader_library_unreadable",
                statusCode: 422,
              },
            );
          selectedEntry = {
            definition: checked.document.definitions[0],
            preset: checked.document.presets?.[0],
            executionHash: stored.executionHash,
          };
        }
        const latestBuiltins = new Map<string, EffectDefinition>();
        for (const definition of NATIVE_EFFECT_DEFINITION_CATALOG) {
          const current = latestBuiltins.get(definition.id);
          if (!current || current.version < definition.version)
            latestBuiltins.set(definition.id, definition);
        }
        const catalogBuiltins = new Map(
          NATIVE_EFFECT_DEFINITION_CATALOG.map((definition) => [
            `builtin:${definition.id}@${definition.version}`,
            definition,
          ]),
        );
        const builtinKeys = [...catalogBuiltins.keys()];
        const builtinActivityRows = builtinKeys.length
          ? await db
              .select({
                itemKey: activityTable.itemKey,
                favorite: activityTable.favorite,
                lastUsedAt: activityTable.lastUsedAt,
              })
              .from(activityTable)
              .where(
                and(
                  eq(activityTable.ownerEmail, ownerEmail),
                  inArray(activityTable.itemKey, builtinKeys),
                ),
              )
              .limit(builtinKeys.length)
          : [];
        const builtinActivity = new Map(
          builtinActivityRows.map((row) => [row.itemKey, row]),
        );
        const builtins = [...catalogBuiltins.entries()]
          .filter(
            ([itemKey, definition]) =>
              latestBuiltins.get(definition.id) === definition ||
              (libraryView !== "all" &&
                Boolean(
                  builtinActivity.get(itemKey)?.favorite ||
                  builtinActivity.get(itemKey)?.lastUsedAt,
                )),
          )
          .map(([itemKey, definition]) => {
            return {
              ...summarizeNativeDefinition(definition),
              itemKey,
              favorite: builtinActivity.get(itemKey)?.favorite ?? false,
              lastUsedAt: builtinActivity.get(itemKey)?.lastUsedAt ?? null,
            };
          })
          .filter(
            (definition) =>
              (!libraryCategory || definition.kind === libraryCategory) &&
              (!librarySearch ||
                definition.name
                  .toLowerCase()
                  .includes(librarySearch.toLowerCase())) &&
              (libraryView === "all" ||
                (libraryView === "favorites" && definition.favorite) ||
                (libraryView === "recent" && definition.lastUsedAt !== null)),
          )
          .sort((left, right) =>
            libraryView === "recent"
              ? (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") ||
                left.id.localeCompare(right.id) ||
                right.version - left.version
              : left.name.localeCompare(right.name) ||
                left.id.localeCompare(right.id) ||
                right.version - left.version,
          );
        const last = page[page.length - 1];
        library = {
          builtins,
          items: page.map((row) => ({
            ...row,
            placements: parseLibraryPlacements(row.placements),
            itemKey: `library:${row.id}`,
            favorite: row.favorite ?? false,
            lastUsedAt: row.lastUsedAt,
          })),
          hasMore: rows.length > libraryLimit,
          nextCursor:
            rows.length > libraryLimit && last
              ? encodeNativeShaderLibraryCursor({
                  view: libraryView,
                  search: librarySearch ?? "",
                  category: libraryCategory ?? null,
                  sortAt: last.sortAt,
                  id: last.id,
                })
              : null,
          selectedEntry,
        };
      }
      if (
        source &&
        (source.kind === "inline-html" ||
          !source.designId ||
          (!source.fileId && !source.path))
      ) {
        fail(
          "native-v2 requires a design-file source with designId and fileId or path",
          {
            errorCode: "native_effect_source_required",
            statusCode: 400,
          },
        );
      }
      let document = null as ReturnType<
        typeof parseEffectsFromHtml
      >["document"];
      let file: { id: string; filename: string } | null = null;
      let versionHash: string | null = null;
      let targetNodeState: "not-requested" | "present" | "missing" =
        "not-requested";
      let approvedDefinitionHashes: string[] = [];
      if (source) {
        const designId = source.designId;
        if (!designId)
          fail("Design source ID is required.", {
            errorCode: "native_effect_source_required",
            statusCode: 400,
          });
        const workspace = await resolveSourceWorkspace(designId, {
          includeContent: false,
          includeBoard: true,
        });
        const selectedFile = source.fileId
          ? workspace.files.find((candidate) => candidate.id === source.fileId)
          : workspace.files.find(
              (candidate) => candidate.filename === source.path,
            );
        if (!selectedFile)
          fail("Design source file not found.", {
            errorCode: "native_effect_file_not_found",
            statusCode: 404,
          });
        if (selectedFile.fileType !== "html")
          fail("Native effects require an inline HTML source file.", {
            errorCode: "native_effect_non_html",
            statusCode: 400,
          });
        const selectedWithContent =
          await loadSelectedSourceWorkspaceFile(selectedFile);
        if (!selectedWithContent)
          fail("Design source file not found.", {
            errorCode: "native_effect_file_not_found",
            statusCode: 404,
          });
        const live = await readLiveSourceFile(selectedWithContent);
        const parsed = inspectNativeEffectHtml(live.content, target?.nodeId);
        if (parsed.errors.length)
          fail(
            `Native effect manifest is unreadable: ${parsed.errors.join("; ")}`,
            {
              errorCode: "native_effect_manifest_unreadable",
              statusCode: 422,
              details: { errors: parsed.errors },
            },
          );
        if (target?.nodeId) {
          const count = parsed.target.activeCount;
          if (count !== 1)
            fail(
              count === 0 && parsed.target.inertCount
                ? `Authored node ${target.nodeId} exists only inside an inert template.`
                : `Expected one authored node ${target.nodeId}, found ${count}.`,
              {
                errorCode: count
                  ? "native_effect_target_ambiguous"
                  : parsed.target.inertCount
                    ? "native_effect_target_inert"
                    : "native_effect_target_not_found",
                statusCode: count || parsed.target.inertCount ? 422 : 404,
              },
            );
          targetNodeState = "present";
        }
        document = parsed.document;
        file = selectedFile;
        versionHash = live.versionHash;
        try {
          approvedDefinitionHashes = parseNativeEffectApprovalState(
            await readAppState(nativeEffectApprovalKey(designId)),
          ).hashes;
        } catch (error) {
          if (!(error instanceof NativeEffectApprovalStateError)) throw error;
          fail("Native effect approval state is unreadable.", {
            errorCode: "native_effect_approvals_unreadable",
            statusCode: 422,
          });
        }
      }
      const definitions = new Map<string, EffectDefinition>();
      for (const definition of [
        ...NATIVE_EFFECT_DEFINITION_CATALOG,
        ...(document?.definitions ?? []),
      ])
        definitions.set(
          `${definition.id}\u0000${definition.version}`,
          definition,
        );
      const catalog = [...definitions.values()].filter(
        (definition) =>
          (!definitionId || definition.id === definitionId) &&
          (!definitionVersion || definition.version === definitionVersion),
      );
      if (definitionId && catalog.length === 0)
        fail("Native effect definition version not found.", {
          errorCode: "native_effect_definition_not_found",
          statusCode: 404,
        });
      const instances = document?.instances ?? [];
      return {
        format,
        manifestState: !source
          ? ("not-requested" as const)
          : document
            ? ("present" as const)
            : ("absent" as const),
        designId: source?.designId ?? null,
        fileId: file?.id ?? null,
        path: file?.filename ?? null,
        versionHash,
        targetNodeState,
        approvedDefinitionHashes,
        manifestPresent: source ? document !== null : null,
        document: document
          ? {
              schemaVersion: document.schemaVersion,
              definitions: document.definitions.map(summarizeNativeDefinition),
              instances: document.instances,
              presets: document.presets ?? [],
              preview: document.preview ?? null,
            }
          : null,
        targetInstances: target?.nodeId
          ? instances.filter((instance) => instance.nodeId === target.nodeId)
          : instances,
        definitions: catalog.map(summarizeNativeDefinition),
        selectedDefinition: includeSource ? catalog[0] : null,
        presets: [...NATIVE_EFFECT_PRESETS, ...(document?.presets ?? [])],
        library,
      };
    }
    const sourceKind = source?.kind ?? "design-file";
    const targetDescription = target?.nodeId
      ? `element with id="${target.nodeId}"`
      : target?.selector
        ? `element matching "${target.selector}"`
        : "any element";

    const inspectionStepsFramework = [
      `1. Read the saved code-layer projection for ${targetDescription}.`,
      `2. Record any historical GLSL source, uniform values, and placement as compatibility metadata.`,
      `3. Keep existing authored shaders readable; this legacy response does not apply or preview one.`,
    ];

    const inspectionStepsInline = [
      `1. Read the saved HTML for ${targetDescription}.`,
      `2. Record any data-shader descriptor and its parameters as historical metadata.`,
      `3. Keep the descriptor readable; this legacy response does not apply or preview one.`,
    ];

    const inspectionSteps =
      sourceKind === "inline-html"
        ? inspectionStepsInline
        : inspectionStepsFramework;

    const hint =
      `For new work, call get-shader with format=native-v2 and the selected design-file source and target nodeId. ` +
      `Choose a returned exact definition version or preset; an example registered fill is ` +
      `an-native-gradient-field version 1 with scale, or preset an-preset-catalog-gradient-field-1. ` +
      `Use the returned versionHash with edit-native-shader to apply it, then read back the source and verify the GPU preview.`;

    const instructions = [
      `To inspect historical shader state on ${targetDescription}:`,
      "",
      ...inspectionSteps,
      "",
      hint,
    ].join("\n");

    return {
      format: "legacy" as const,
      savedDescriptorStatus: "read-only" as const,
      instructions,
      hint,
    };
  },
});
