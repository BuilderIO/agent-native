import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import {
  parseEffectsFromHtml,
  validateEffectDocument,
  type EffectPreset,
} from "../shared/native-effects.js";

const itemKey = z
  .string()
  .regex(
    /^(library:[A-Za-z0-9_-]{1,128}|builtin:[A-Za-z0-9_.:-]{1,120}@[1-9]\d*)$/,
  );
const operation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("register"),
    designId: z.string().min(1),
    fileId: z.string().min(1),
    expectedVersionHash: z.string().min(1),
    instanceId: z.string().min(1),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).optional(),
  }),
  z.object({
    kind: z.literal("rename"),
    itemId: z.string().min(1),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).nullable().optional(),
  }),
  z.object({ kind: z.literal("remove"), itemId: z.string().min(1) }),
  z.object({ kind: z.literal("favorite"), itemKey, favorite: z.boolean() }),
  z.object({ kind: z.literal("mark-used"), itemKey }),
]);

function currentViewer(): string {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email)
    fail("Sign in to use the Shader Library.", {
      errorCode: "native_shader_library_auth_required",
      statusCode: 401,
    });
  return email;
}

async function assertLibraryKey(
  ownerEmail: string,
  key: string,
): Promise<void> {
  if (key.startsWith("builtin:")) {
    const identity = key.slice("builtin:".length);
    if (
      NATIVE_EFFECT_DEFINITION_CATALOG.some(
        (definition) => `${definition.id}@${definition.version}` === identity,
      )
    )
      return;
  } else {
    const [row] = await getDb()
      .select({ id: schema.nativeShaderLibrary.id })
      .from(schema.nativeShaderLibrary)
      .where(
        and(
          eq(schema.nativeShaderLibrary.id, key.slice("library:".length)),
          eq(schema.nativeShaderLibrary.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (row) return;
  }
  fail("Shader Library item not found.", {
    errorCode: "native_shader_library_not_found",
    statusCode: 404,
  });
}

export default defineAction({
  description:
    "Register a validated native shader instance from the current Design source as a private reusable Shader Library item, rename or remove one, or update your own favorite/recent state. Registration requires Design editor access and an exact source version. This never approves executable WGSL for a viewer.",
  requiresAuth: true,
  schema: z.object({ operation }),
  run: async ({ operation: edit }) => {
    const ownerEmail = currentViewer();
    const db = getDb();
    if (edit.kind === "register") {
      const workspace = await resolveSourceWorkspace(edit.designId, {
        includeContent: false,
        includeBoard: true,
      });
      if (!workspace.canEdit || workspace.sourceType !== "inline")
        fail("Design editor access is required to register this shader.", {
          errorCode: "native_shader_library_edit_required",
          statusCode: 403,
        });
      const file = workspace.files.find(
        (candidate) => candidate.id === edit.fileId,
      );
      if (!file || file.fileType !== "html")
        fail("HTML Design source file not found.", {
          errorCode: "native_shader_library_source_not_found",
          statusCode: 404,
        });
      const selected = await loadSelectedSourceWorkspaceFile(file);
      if (!selected)
        fail("Design source file not found.", {
          errorCode: "native_shader_library_source_not_found",
          statusCode: 404,
        });
      const live = await readLiveSourceFile(selected);
      if (live.versionHash !== edit.expectedVersionHash)
        fail("Design source changed. Re-read and retry.", {
          errorCode: "native_shader_library_stale_source",
          statusCode: 409,
        });
      const parsed = parseEffectsFromHtml(live.content);
      if (parsed.errors.length || !parsed.document)
        fail("Native effect manifest is unreadable.", {
          errorCode: "native_shader_library_manifest_unreadable",
          statusCode: 422,
          details: { errors: parsed.errors },
        });
      const instance = parsed.document.instances.find(
        (candidate) => candidate.id === edit.instanceId,
      );
      const definition = parsed.document.definitions.find(
        (candidate) =>
          candidate.id === instance?.definitionId &&
          candidate.version === instance.definitionVersion,
      );
      if (!instance || !definition)
        fail("Native shader instance or its pinned definition was not found.", {
          errorCode: "native_shader_library_instance_not_found",
          statusCode: 404,
        });
      const id = nanoid();
      const preset: EffectPreset = {
        id: `library.${id}`,
        name: edit.name,
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement: instance.placement,
        params: instance.params,
        clip: instance.clip,
        ...(instance.bindings ? { bindings: instance.bindings } : {}),
        ...(instance.transform ? { transform: instance.transform } : {}),
        provenance: { origin: "user-authored" },
      };
      const valid = validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
        presets: [preset],
      });
      if (!valid.valid)
        fail("Shader Library item failed native effect validation.", {
          errorCode: "native_shader_library_invalid",
          statusCode: 422,
          details: { errors: valid.errors },
        });
      const definitionJson = JSON.stringify(definition);
      const presetJson = JSON.stringify(preset);
      if (definitionJson.length + presetJson.length > 160_000)
        fail("Shader Library item exceeds the source limit.", {
          errorCode: "native_shader_library_too_large",
          statusCode: 413,
        });
      const existing = await db
        .select({ id: schema.nativeShaderLibrary.id })
        .from(schema.nativeShaderLibrary)
        .where(eq(schema.nativeShaderLibrary.ownerEmail, ownerEmail))
        .limit(513);
      if (existing.length >= 512)
        fail("Shader Library is full.", {
          errorCode: "native_shader_library_full",
          statusCode: 422,
        });
      const executionHash = await hashEffectDefinition(definition);
      await db.insert(schema.nativeShaderLibrary).values({
        id,
        name: edit.name,
        description: edit.description ?? null,
        category: definition.kind,
        definitionId: definition.id,
        definitionVersion: definition.version,
        executionHash,
        kind: definition.kind,
        placements: JSON.stringify(definition.placements),
        presetPlacement: preset.placement,
        propertyCount: Object.keys(definition.properties).length,
        passCount: definition.passes.length,
        definitionJson,
        presetJson,
        ownerEmail,
      });
      return {
        itemId: id,
        itemKey: `library:${id}`,
        executionHash,
        sourceVersionHash: live.versionHash,
      };
    }
    if (edit.kind === "rename" || edit.kind === "remove") {
      const where = and(
        eq(schema.nativeShaderLibrary.id, edit.itemId),
        eq(schema.nativeShaderLibrary.ownerEmail, ownerEmail),
      );
      const [row] = await db
        .select({ id: schema.nativeShaderLibrary.id })
        .from(schema.nativeShaderLibrary)
        .where(where)
        .limit(1);
      if (!row)
        fail("Shader Library item not found.", {
          errorCode: "native_shader_library_not_found",
          statusCode: 404,
        });
      if (edit.kind === "rename")
        await db
          .update(schema.nativeShaderLibrary)
          .set({
            name: edit.name,
            ...(edit.description !== undefined
              ? { description: edit.description }
              : {}),
            updatedAt: new Date().toISOString(),
          })
          .where(where);
      else {
        await db.delete(schema.nativeShaderLibrary).where(where);
        await db
          .delete(schema.nativeShaderLibraryActivity)
          .where(
            and(
              eq(schema.nativeShaderLibraryActivity.ownerEmail, ownerEmail),
              eq(
                schema.nativeShaderLibraryActivity.itemKey,
                `library:${edit.itemId}`,
              ),
            ),
          );
      }
      return { itemId: edit.itemId, removed: edit.kind === "remove" };
    }
    await assertLibraryKey(ownerEmail, edit.itemKey);
    const now = new Date().toISOString();
    await db
      .insert(schema.nativeShaderLibraryActivity)
      .values({
        ownerEmail,
        itemKey: edit.itemKey,
        favorite: edit.kind === "favorite" ? edit.favorite : false,
        lastUsedAt: edit.kind === "mark-used" ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.nativeShaderLibraryActivity.ownerEmail,
          schema.nativeShaderLibraryActivity.itemKey,
        ],
        set:
          edit.kind === "favorite"
            ? { favorite: edit.favorite, updatedAt: now }
            : { lastUsedAt: now, updatedAt: now },
      });
    return {
      itemKey: edit.itemKey,
      favorite: edit.kind === "favorite" ? edit.favorite : null,
      lastUsedAt: edit.kind === "mark-used" ? now : null,
    };
  },
});
