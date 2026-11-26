import { defineActionErrors } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { readBrainSettings } from "./brain.js";
import { sanitizeCaptureForStorage } from "./capture-sanitization.js";

export const personalErrors = defineActionErrors(
  "unauthenticated",
  "not_found",
  "invalid_record",
  "record_limit",
  "privacy_restricted",
  "stored_data_invalid",
  "save_conflict",
  "scope_empty",
);
export const personalMemorySchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(2000),
  updatedAt: z.string().datetime(),
});
export const recipeSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(6000),
  sourceIds: z.array(z.string()).max(50),
  projectId: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
const memoryStoreSchema = z.object({
  records: z.array(personalMemorySchema).max(100),
});
const recipeStoreSchema = z.object({ records: z.array(recipeSchema).max(100) });

function owner() {
  const email = getRequestUserEmail();
  if (!email)
    return personalErrors.fail(
      "Sign in to manage your personal context.",
      "unauthenticated",
      { statusCode: 401 },
    );
  return email;
}

function settingKey(kind: "memory" | "recipes") {
  return `brain-personal-${kind}:${JSON.stringify(getRequestOrgId() ?? null)}`;
}

function readRecords<T>(
  stored: Record<string, unknown> | null,
  validator: z.ZodType<{ records: T[] }>,
) {
  if (stored === null) return [];
  const parsed = validator.safeParse(stored);
  if (!parsed.success)
    return personalErrors.fail(
      "Personal context could not be read. No records were changed.",
      "stored_data_invalid",
      { statusCode: 500 },
    );
  return parsed.data.records;
}

function nextRevision(previous: string | undefined) {
  return new Date(
    Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0),
  ).toISOString();
}

export async function listPersonalMemories() {
  return {
    memories: readRecords(
      await getUserSetting(owner(), settingKey("memory")),
      memoryStoreSchema,
    ),
  };
}

export async function listRecipes() {
  return {
    recipes: readRecords(
      await getUserSetting(owner(), settingKey("recipes")),
      recipeStoreSchema,
    ),
  };
}

export async function managePersonalMemory(args: {
  operation: "save" | "delete";
  id?: string | undefined;
  content?: string | undefined;
  expectedRevision?: string | undefined;
}) {
  const email = owner();
  const id = args.id ?? crypto.randomUUID();
  if (args.operation === "delete" && !args.id)
    return personalErrors.fail("Choose a memory to delete.", "invalid_record");
  let content: string | undefined;
  if (args.operation === "save") {
    if (!args.content?.trim())
      return personalErrors.fail("Enter a memory.", "invalid_record");
    const settings = await readBrainSettings();
    const safe = await sanitizeCaptureForStorage({
      kind: "note",
      title: "Personal work preference",
      content: args.content.trim(),
      capturedAt: new Date().toISOString(),
      source: {
        id: "personal-memory",
        title: "Personal context",
        provider: "manual",
        ownerEmail: email,
        orgId: getRequestOrgId() ?? null,
      },
      settings,
    });
    if (safe.decision?.disposition !== "allowed")
      return personalErrors.fail(
        "This memory cannot be saved under Brain's privacy policy.",
        "privacy_restricted",
      );
    content = safe.content;
  }
  await mutateUserSetting(email, settingKey("memory"), (stored) => {
    const records = readRecords(stored, memoryStoreSchema);
    if (args.id && !records.some((record) => record.id === id))
      return personalErrors.fail("Memory not found.", "not_found", {
        statusCode: 404,
      });
    if (
      args.id &&
      records.find((record) => record.id === id)?.updatedAt !==
        args.expectedRevision
    )
      return personalErrors.fail(
        "This record changed. Refresh before saving again.",
        "save_conflict",
        { statusCode: 409 },
      );
    if (args.operation === "delete")
      return { records: records.filter((record) => record.id !== id) };
    if (!content)
      return personalErrors.fail("Enter a memory.", "invalid_record");
    if (!args.id && records.length >= 100)
      return personalErrors.fail(
        "Delete a memory before adding another.",
        "record_limit",
      );
    const record = personalMemorySchema.parse({
      id,
      content,
      updatedAt: nextRevision(records.find((row) => row.id === id)?.updatedAt),
    });
    return { records: [record, ...records.filter((row) => row.id !== id)] };
  });
  return { id, deleted: args.operation === "delete" };
}

export async function validateRecipeScope(
  recipe: z.infer<typeof recipeSchema>,
) {
  if (recipe.projectId)
    await assertAccess("brain-project", recipe.projectId, "viewer");
  for (const sourceId of recipe.sourceIds)
    await assertAccess("brain-source", sourceId, "viewer");
}

export async function manageRecipe(args: {
  operation: "save" | "delete";
  id?: string | undefined;
  title?: string | undefined;
  prompt?: string | undefined;
  expectedRevision?: string | undefined;
  sourceIds?: string[] | undefined;
  projectId?: string | null | undefined;
}) {
  const email = owner();
  const id = args.id ?? crypto.randomUUID();
  if (args.operation === "delete" && !args.id)
    return personalErrors.fail("Choose a recipe to delete.", "invalid_record");
  let recipe: z.infer<typeof recipeSchema> | undefined;
  if (args.operation === "save") {
    const parsed = recipeSchema.safeParse({
      id,
      title: args.title?.trim(),
      prompt: args.prompt?.trim(),
      sourceIds: [...new Set(args.sourceIds ?? [])],
      projectId: args.projectId ?? null,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success)
      return personalErrors.fail(
        "Enter a title and prompt for the recipe.",
        "invalid_record",
      );
    recipe = parsed.data;
    await validateRecipeScope(recipe);
  }
  await mutateUserSetting(email, settingKey("recipes"), (stored) => {
    const records = readRecords(stored, recipeStoreSchema);
    if (args.id && !records.some((record) => record.id === id))
      return personalErrors.fail("Recipe not found.", "not_found", {
        statusCode: 404,
      });
    if (
      args.id &&
      records.find((record) => record.id === id)?.updatedAt !==
        args.expectedRevision
    )
      return personalErrors.fail(
        "This record changed. Refresh before saving again.",
        "save_conflict",
        { statusCode: 409 },
      );
    if (args.operation === "delete")
      return { records: records.filter((record) => record.id !== id) };
    if (!recipe)
      return personalErrors.fail(
        "Enter a title and prompt for the recipe.",
        "invalid_record",
      );
    if (!args.id && records.length >= 100)
      return personalErrors.fail(
        "Delete a recipe before adding another.",
        "record_limit",
      );
    return {
      records: [
        {
          ...recipe,
          updatedAt: nextRevision(
            records.find((row) => row.id === id)?.updatedAt,
          ),
        },
        ...records.filter((row) => row.id !== id),
      ],
    };
  });
  return { id, deleted: args.operation === "delete" };
}

export async function prepareRecipe(id: string) {
  const { recipes } = await listRecipes();
  const recipe = recipes.find((row) => row.id === id);
  if (!recipe)
    return personalErrors.fail("Recipe not found.", "not_found", {
      statusCode: 404,
    });
  await validateRecipeScope(recipe);
  let sourceIds: string[] | null = recipe.sourceIds.length
    ? recipe.sourceIds
    : null;
  if (recipe.projectId) {
    const memberships = await getDb()
      .select({ sourceId: schema.brainProjectSources.sourceId })
      .from(schema.brainProjectSources)
      .where(eq(schema.brainProjectSources.projectId, recipe.projectId))
      .limit(1001);
    if (memberships.length > 1000)
      return personalErrors.fail(
        "This project has too many sources for a recipe. Choose a smaller project.",
        "record_limit",
      );
    const projectSources = new Set(memberships.map((row) => row.sourceId));
    sourceIds =
      sourceIds === null
        ? [...projectSources]
        : sourceIds.filter((id) => projectSources.has(id));
    for (const sourceId of sourceIds)
      await assertAccess("brain-source", sourceId, "viewer");
  }
  if (sourceIds !== null && !sourceIds.length)
    return personalErrors.fail(
      "This recipe has no sources in its current scope. Select accessible sources or update the project.",
      "scope_empty",
    );
  return { recipe, scope: { sourceIds, projectId: recipe.projectId } };
}
