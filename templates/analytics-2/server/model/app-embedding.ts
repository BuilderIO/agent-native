import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { fail } from "@agent-native/core/action";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { notebookMessages } from "../../app/i18n/messages/notebook.js";
import {
  type createPresignedEmbedUrlInput,
  type getProjectEmbeddingInput,
  type PresignedEmbedTokenVerification,
  type PresignedEmbedUrl,
  type ProjectEmbeddingSettings,
  type setProjectEmbeddingInput,
  type verifyPresignedEmbedTokenInput,
  createPresignedEmbedUrlOutput,
  projectEmbeddingSettingsSchema,
  verifyPresignedEmbedTokenOutput,
} from "../../shared/app-embedding.js";
import { capabilityScopeRefSchema } from "../../shared/capabilities.js";
import { getDb, schema } from "../db/index.js";
import {
  ANALYTICS_CONTROL_IDS,
  requireCapability,
} from "../lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { getReadableProjectRow } from "./project-access.js";
import {
  canManageProject,
  projectAccessLevel,
} from "./project-grant-access.js";
import type { Queryable } from "./scope.js";

const { projects, projectReleases, projectVersions, signedEmbedTokens } =
  schema;
const copy = notebookMessages.publishedAppSharing;

function signingKey(): Buffer {
  const seed = process.env.DATABASE_URL || "analytics2-signed-embed-key";
  return createHash("sha256")
    .update(`analytics2-signed-embed-v1:${seed}`)
    .digest();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signPayload(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function signedEmbedActionPath(): string {
  return `${getConfiguredAppBasePath()}/_agent-native/actions/create-presigned-embed-url`;
}

function projectNotFound(): never {
  return fail(copy.denied, {
    statusCode: 404,
    errorCode: "project_not_found",
  });
}

async function publishedAppHref(
  db: Queryable,
  project: typeof projects.$inferSelect,
): Promise<string | null> {
  if (!project.publishedVersionId) return null;
  const [release] = await db
    .select({ id: projectReleases.id })
    .from(projectReleases)
    .where(
      and(
        eq(projectReleases.projectId, project.id),
        eq(projectReleases.id, project.publishedVersionId),
        eq(projectReleases.orgId, project.orgId ?? ""),
      ),
    )
    .limit(1);
  if (release) {
    return `${getConfiguredAppBasePath()}/app/${encodeURIComponent(project.id)}/latest`;
  }
  const [legacy] = await db
    .select({ id: projectVersions.id })
    .from(projectVersions)
    .where(
      and(
        eq(projectVersions.projectId, project.id),
        eq(projectVersions.id, project.publishedVersionId),
        eq(projectVersions.kind, "published"),
      ),
    )
    .limit(1);
  return legacy
    ? `${getConfiguredAppBasePath()}/app/${encodeURIComponent(project.id)}/latest`
    : null;
}

async function requireEmbeddingManager(projectId: string) {
  const current = await requireCurrentWorkspace();
  await ensureAnalyticsDatabase();
  const project = await getReadableProjectRow(current, projectId);
  if (!project || project.trashedAt) projectNotFound();
  await requireCapability(
    ANALYTICS_CONTROL_IDS.manageAppSharing,
    capabilityScopeRefSchema.parse({
      kind: "project",
      workspaceId: current.orgId,
      projectId,
    }),
  );
  return { current, project };
}

export async function getProjectEmbeddingSettings(
  input: z.infer<typeof getProjectEmbeddingInput>,
): Promise<ProjectEmbeddingSettings> {
  const current = await requireCurrentWorkspace();
  await ensureAnalyticsDatabase();
  const project = await getReadableProjectRow(current, input.projectId);
  if (!project || project.trashedAt) projectNotFound();
  const db = getDb();
  const [level, appHref] = await Promise.all([
    projectAccessLevel(current, project, [], db),
    publishedAppHref(db, project),
  ]);
  return projectEmbeddingSettingsSchema.parse({
    projectId: project.id,
    published: appHref !== null,
    allowEmbedding: project.allowEmbedding,
    canManageEmbedding: canManageProject(level),
    appHref,
    signedEmbedActionPath: signedEmbedActionPath(),
  });
}

export async function setProjectEmbeddingSettings(
  input: z.infer<typeof setProjectEmbeddingInput>,
): Promise<ProjectEmbeddingSettings> {
  const { current, project } = await requireEmbeddingManager(input.projectId);
  const db = getDb();
  const now = nowIso();
  await db
    .update(projects)
    .set({
      allowEmbedding: input.allowEmbedding,
      updatedAt: now,
    })
    .where(
      and(eq(projects.id, project.id), eq(projects.orgId, current.orgId)),
    );
  if (!input.allowEmbedding) {
    await db
      .update(signedEmbedTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(signedEmbedTokens.orgId, current.orgId),
          eq(signedEmbedTokens.projectId, project.id),
          isNull(signedEmbedTokens.revokedAt),
        ),
      );
  }
  const appHref = await publishedAppHref(db, project);
  return projectEmbeddingSettingsSchema.parse({
    projectId: project.id,
    published: appHref !== null,
    allowEmbedding: input.allowEmbedding,
    canManageEmbedding: true,
    appHref,
    signedEmbedActionPath: signedEmbedActionPath(),
  });
}

export async function createPresignedEmbedUrl(
  input: z.infer<typeof createPresignedEmbedUrlInput>,
): Promise<PresignedEmbedUrl> {
  const { current, project } = await requireEmbeddingManager(input.projectId);
  if (!project.allowEmbedding) {
    fail("Signed embedding is not enabled for this project.", {
      statusCode: 400,
      errorCode: "embedding_not_enabled",
    });
  }
  const db = getDb();
  const appHref = await publishedAppHref(db, project);
  if (!appHref) {
    fail("Publish this project before creating a signed embed URL.", {
      statusCode: 400,
      errorCode: "project_not_published",
    });
  }
  const id = newId("emb");
  const createdAt = nowIso();
  const expiresAt = new Date(
    Date.parse(createdAt) + input.expiresInSeconds * 1000,
  ).toISOString();
  const nonce = randomBytes(24).toString("base64url");
  const signature = signPayload(
    `${current.orgId}:${project.id}:${nonce}:${createdAt}`,
  );
  const token = `emb_${nonce}.${signature}`;
  const tokenHash = hashToken(token);

  await db.insert(signedEmbedTokens).values({
    id,
    orgId: current.orgId,
    projectId: project.id,
    createdByEmail: current.ownerEmail,
    tokenHash,
    userAttributes: input.userAttributes,
    expiresAt,
    revokedAt: null,
    createdAt,
  });

  const embedPath = `${appHref}?embedded=true&embedToken=${encodeURIComponent(token)}`;
  return createPresignedEmbedUrlOutput.parse({
    id,
    projectId: project.id,
    embedPath,
    token,
    expiresAt,
    userAttributes: input.userAttributes,
  });
}

function invalidResult(
  projectId: string,
  reason: PresignedEmbedTokenVerification["reason"],
): PresignedEmbedTokenVerification {
  return verifyPresignedEmbedTokenOutput.parse({
    valid: false,
    projectId,
    expiresAt: null,
    userAttributes: {},
    reason,
  });
}

export async function verifyPresignedEmbedToken(
  input: z.infer<typeof verifyPresignedEmbedTokenInput>,
): Promise<PresignedEmbedTokenVerification> {
  await ensureAnalyticsDatabase();
  const db = getDb();
  const tokenHash = hashToken(input.token);
  const [row] = await db
    .select({
      token: signedEmbedTokens,
      project: projects,
    })
    .from(signedEmbedTokens)
    .innerJoin(projects, eq(projects.id, signedEmbedTokens.projectId))
    .where(
      and(
        eq(signedEmbedTokens.tokenHash, tokenHash),
        eq(signedEmbedTokens.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!row) return invalidResult(input.projectId, "invalid");

  const parts = input.token.split(".");
  if (parts.length !== 2 || !parts[0]?.startsWith("emb_")) {
    return invalidResult(input.projectId, "invalid");
  }
  const nonce = parts[0].slice(4);
  const providedSig = Buffer.from(parts[1] ?? "", "utf8");
  const expectedSig = Buffer.from(
    signPayload(
      `${row.token.orgId}:${row.token.projectId}:${nonce}:${row.token.createdAt}`,
    ),
    "utf8",
  );
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return invalidResult(input.projectId, "invalid");
  }

  if (row.project.trashedAt || !row.project.publishedVersionId) {
    return invalidResult(input.projectId, "unpublished");
  }
  if (!row.project.allowEmbedding) {
    return invalidResult(input.projectId, "disabled");
  }
  if (row.token.revokedAt !== null) {
    return invalidResult(input.projectId, "revoked");
  }
  if (Date.parse(row.token.expiresAt) <= Date.now()) {
    return invalidResult(input.projectId, "expired");
  }

  return verifyPresignedEmbedTokenOutput.parse({
    valid: true,
    projectId: row.token.projectId,
    expiresAt: row.token.expiresAt,
    userAttributes: row.token.userAttributes ?? {},
    reason: "ok",
  });
}
