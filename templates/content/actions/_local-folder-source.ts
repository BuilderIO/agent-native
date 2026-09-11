import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  ContentDatabaseSourceCapabilities,
  ContentDatabaseSourceTruthPolicy,
} from "../shared/api.js";

export const LOCAL_FOLDER_SOURCE_TYPE = "local-folder" as const;

export const localFolderOpaqueIdentitySchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("..") &&
      !value.includes("\0"),
    "Local source identities must be opaque IDs, not paths.",
  );

const labelSchema = z.string().trim().min(1).max(200);

export const localFolderSourceConnectionMetadataSchema = z
  .object({
    repository: z
      .object({
        localId: localFolderOpaqueIdentitySchema,
        providerBinding: z
          .object({
            provider: z.literal("github"),
            repositoryId: localFolderOpaqueIdentitySchema,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    workingCopy: z
      .object({
        id: localFolderOpaqueIdentitySchema,
        repositoryId: localFolderOpaqueIdentitySchema.optional(),
        kind: z.enum(["persistent", "temporary"]),
        name: labelSchema,
        branch: z.string().trim().min(1).max(300).optional(),
        commit: z.string().trim().min(1).max(300).optional(),
        deviceId: localFolderOpaqueIdentitySchema,
      })
      .strict()
      .optional(),
    liveBridgeEnabled: z.boolean().optional().default(false),
  })
  .strict();

export type LocalFolderSourceConnectionMetadata = z.infer<
  typeof localFolderSourceConnectionMetadataSchema
>;

export type LocalFolderSourceIdentity = {
  repository?: {
    localId: string;
    providerBinding?: { provider: "github"; repositoryId: string };
  };
  workingCopy: {
    id: string;
    repositoryId?: string;
    kind: "persistent" | "temporary";
    name: string;
    branch?: string;
    commit?: string;
    deviceId: string;
    localOnly: boolean;
    shareable: boolean;
  };
};

export function localFolderSourceIdentityFromMetadata(
  value: unknown,
): LocalFolderSourceIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const stored = value as {
    repository?: unknown;
    workingCopy?: Record<string, unknown>;
  };
  const connectionMetadata =
    localFolderSourceConnectionMetadataSchema.safeParse({
      repository: stored.repository,
      workingCopy: stored.workingCopy
        ? Object.fromEntries(
            Object.entries(stored.workingCopy).filter(
              ([key]) => key !== "localOnly" && key !== "shareable",
            ),
          )
        : undefined,
    });
  if (!connectionMetadata.success || !connectionMetadata.data.workingCopy) {
    return undefined;
  }
  try {
    return normalizeLocalFolderSourceIdentity({
      connectionId: "stored-local-source",
      label: connectionMetadata.data.workingCopy.name,
      connectionMetadata: connectionMetadata.data,
    });
  } catch {
    // coercion-ok: invalid legacy metadata is represented as absent optional identity
    return undefined;
  }
}

export function normalizeLocalFolderSourceIdentity(input: {
  connectionId: string;
  label: string;
  connectionMetadata?: LocalFolderSourceConnectionMetadata;
}): LocalFolderSourceIdentity {
  const metadata = localFolderSourceConnectionMetadataSchema.parse(
    input.connectionMetadata ?? {},
  );
  const workingCopy = metadata.workingCopy ?? {
    id: input.connectionId,
    kind: "persistent" as const,
    name: input.label,
    deviceId: "unknown-device",
  };
  if (
    workingCopy.repositoryId &&
    (!metadata.repository ||
      workingCopy.repositoryId !== metadata.repository.localId)
  ) {
    throw new Error(
      "Working-copy repositoryId must match the supplied repository identity.",
    );
  }
  return {
    ...(metadata.repository ? { repository: metadata.repository } : {}),
    workingCopy: {
      ...workingCopy,
      localOnly: workingCopy.kind === "temporary",
      shareable: workingCopy.kind !== "temporary",
    },
  };
}

export function localFolderObservedRevision(input: {
  contentHash: string;
  metadataHash: string;
}) {
  return `sha256:${createHash("sha256")
    .update(`${input.contentHash}:${input.metadataHash}`)
    .digest("hex")}`;
}

export function localFolderSourceFileIdentity(input: {
  workingCopyId: string;
  relativePath: string;
  observedRevision: string;
}) {
  const relativePath = input.relativePath.replace(/\\/g, "/");
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(
      "Local source file identity requires a safe relative path.",
    );
  }
  return { ...input, relativePath };
}

export function localFolderSourceId(databaseId: string, connectionId: string) {
  return `content_database_source_local_folder_${createHash("sha256")
    .update(`${databaseId}:${connectionId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function localFolderSourceCapabilities(input?: {
  liveBridgeEnabled?: boolean;
}): ContentDatabaseSourceCapabilities {
  return {
    canRefresh: true,
    canCreateChangeSets: true,
    canWriteFields: true,
    canWriteBody: true,
    canPush: true,
    canPull: true,
    canPublish: false,
    canDelete: true,
    canStageLocalRevision: true,
    liveWritesEnabled: input?.liveBridgeEnabled === true,
    readOnlyRefresh: false,
    canRename: true,
    canReveal: true,
    canUseLocalComponents: true,
  };
}

export function localFolderSourceMetadata(input: {
  connectionId: string;
  label: string;
  truthPolicy: ContentDatabaseSourceTruthPolicy;
  connectionMetadata?: LocalFolderSourceConnectionMetadata;
}) {
  const connectionMetadata = localFolderSourceConnectionMetadataSchema.parse(
    input.connectionMetadata ?? {},
  );
  const identity = normalizeLocalFolderSourceIdentity({
    connectionId: input.connectionId,
    label: input.label,
    connectionMetadata,
  });
  return {
    primaryKey: "relative_path",
    naturalKeyField: "relative_path",
    titleField: "title",
    readMode: "trusted-local-bridge",
    connectionId: input.connectionId,
    connectionLabel: input.label,
    truthPolicy: input.truthPolicy,
    writeMode: "stage_only" as const,
    syncPolicy:
      connectionMetadata.liveBridgeEnabled === true
        ? ("keep_in_sync" as const)
        : ("manual" as const),
    liveBridgeEnabled: connectionMetadata.liveBridgeEnabled === true,
    localIdentity: identity,
    notes:
      "The trusted local bridge owns the folder handle or path; SQL stores only this opaque connection identity.",
  };
}
