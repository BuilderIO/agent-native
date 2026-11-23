import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  attachmentFailureToError,
  mintAttachmentRef,
  resolveAttachment,
  unwrapAttachment,
} from "@agent-native/core/private-blob";
import {
  resourceGetByPath,
  resourceListContentByOwnersAndPrefixes,
  resourcePut,
} from "@agent-native/core/resources";

import { phase1AskFixture } from "../lib/phase1-ask-fixture.js";
import {
  requireReadableProject,
  requireWritableProject,
} from "../lib/project-action-access.js";
import {
  assertProjectFileParent,
  withProjectFileGuard,
} from "./project-file-cleanup.js";
import {
  projectFileSchema,
  storedProjectFileSchema as storedFileSchema,
  projectFilePrefix as prefix,
  type ProjectFile,
} from "./project-file-metadata.js";

export {
  projectFileSchema,
  type ProjectFile,
} from "./project-file-metadata.js";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function listProjectFiles(
  projectId: string,
): Promise<ProjectFile[]> {
  const { scope, project } = await requireReadableProject(projectId);
  const rows = await resourceListContentByOwnersAndPrefixes(
    [project.ownerEmail],
    [prefix(scope.orgId, project.id)],
    { orgId: scope.orgId },
  );
  return rows
    .map((row) => storedFileSchema.parse(JSON.parse(row.content)))
    .filter((file) => !file.trashed)
    .map((file) => projectFileSchema.parse(file))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        a.filename.localeCompare(b.filename),
    );
}

export async function uploadProjectFile(input: {
  projectId: string;
  filename: string;
  mimeType: string;
  dataBase64: string;
}) {
  const { scope, project } = await requireWritableProject(input.projectId);
  const fileScope = { ownerEmail: project.ownerEmail, orgId: scope.orgId };
  return withProjectFileGuard(fileScope, project.id, async () => {
    await assertProjectFileParent(fileScope, project.id);
    // The action transport has a bounded request size. Reject oversized bytes;
    // never silently truncate a file or persist its body in a resource row.
    const data = Buffer.from(input.dataBase64, "base64");
    if (!data.length || data.length > MAX_FILE_BYTES)
      fail("Choose a nonempty file no larger than 2 MB.", {
        statusCode: 413,
        errorCode: "project_file_size",
      });
    const filename = input.filename.replace(/.*[\\/]/, "").trim();
    if (!filename)
      fail("Choose a file with a name.", {
        statusCode: 400,
        errorCode: "project_file_name",
      });
    const result = phase1AskFixture()?.failUpload(filename)
      ? ({
          status: "storageUnavailable",
          reason: "provider_unavailable",
          whoCanFix: "self_resolving",
          filename,
        } as const)
      : await mintAttachmentRef({
          data,
          filename,
          mimeType: input.mimeType,
          ownerEmail: project.ownerEmail,
          orgId: scope.orgId,
        });
    if (result.status !== "ok") throw attachmentFailureToError(result);
    const file: ProjectFile = {
      id: randomUUID(),
      filename,
      mimeType: input.mimeType,
      bytes: data.length,
      createdAt: new Date().toISOString(),
    };
    await resourcePut(
      project.ownerEmail,
      prefix(scope.orgId, project.id) + file.id,
      JSON.stringify({ ...file, ref: result.ref, trashed: false }),
      "application/json",
    );
    return { file };
  });
}

export async function readProjectFile(projectId: string, fileId: string) {
  const { scope, project } = await requireReadableProject(projectId);
  const resource = await resourceGetByPath(
    project.ownerEmail,
    prefix(scope.orgId, project.id) + fileId,
    { orgId: scope.orgId },
  );
  const metadata = resource
    ? storedFileSchema.parse(JSON.parse(resource.content))
    : null;
  if (!resource || !metadata || metadata.trashed)
    return fail("That file is not in this project.", {
      statusCode: 404,
      errorCode: "project_file_not_found",
    });
  const file = unwrapAttachment(
    await resolveAttachment(metadata.ref, {
      ownerEmail: project.ownerEmail,
      orgId: scope.orgId,
    }),
  );
  return {
    file: projectFileSchema.parse(metadata),
    dataBase64: file.data.toString("base64"),
    attachmentRef: metadata.ref,
    text: metadata.mimeType.startsWith("text/")
      ? file.data.toString("utf8")
      : null,
  };
}

export async function getOwnedProjectFileMetadata(
  ownerEmail: string,
  orgId: string,
  projectId: string,
  fileId: string,
) {
  const resource = await resourceGetByPath(
    ownerEmail,
    prefix(orgId, projectId) + fileId,
    { orgId },
  );
  if (!resource) return null;
  const metadata = storedFileSchema.parse(JSON.parse(resource.content));
  return metadata.trashed ? null : projectFileSchema.parse(metadata);
}

export async function trashProjectFile(projectId: string, fileId: string) {
  const { scope, project } = await requireWritableProject(projectId);
  const fileScope = { ownerEmail: project.ownerEmail, orgId: scope.orgId };
  return withProjectFileGuard(fileScope, project.id, async () => {
    await assertProjectFileParent(fileScope, project.id);
    const path = prefix(scope.orgId, project.id) + fileId;
    const resource = await resourceGetByPath(project.ownerEmail, path, {
      orgId: scope.orgId,
    });
    if (!resource)
      return fail("That file is not in this project.", {
        statusCode: 404,
        errorCode: "project_file_not_found",
      });
    const metadata = storedFileSchema.parse(JSON.parse(resource.content));
    await resourcePut(
      project.ownerEmail,
      path,
      JSON.stringify({ ...metadata, trashed: true }),
      resource.mimeType,
    );
    return { trashed: true };
  });
}
