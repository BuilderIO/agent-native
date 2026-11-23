import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetAppConfigForTests } from "@agent-native/core/app-config";
import { closeDbExec } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
  PrivateBlobError,
  mintAttachmentRef,
} from "@agent-native/core/private-blob";
import {
  resourceListContentByOwnersAndPrefixes,
  resourcePut,
} from "@agent-native/core/resources";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ orgId: "files-org-a", denied: false }));
vi.mock("../lib/project-action-access.js", () => {
  const authorize = async (projectId: string) => {
    if (access.denied) throw new Error("Project access denied");
    return {
      scope: { ownerEmail: "files-owner@example.test", orgId: access.orgId },
      project: { id: projectId, ownerEmail: "files-owner@example.test" },
    };
  };
  return {
    requireReadableProject: authorize,
    requireWritableProject: authorize,
  };
});

import { getDb, schema } from "../db/index.js";
import { purgeDeletedProjectFiles } from "./project-file-cleanup.js";
import { storedProjectFileSchema } from "./project-file-metadata.js";
import {
  listProjectFiles,
  readProjectFile,
  trashProjectFile,
  uploadProjectFile,
} from "./project-files.js";
import {
  createProject,
  updateProject,
  deleteProjectPermanently,
  getProjectDocument,
} from "./projects-store.js";

const blobs = new Map<string, Uint8Array>();
const storage = {
  failure: "" as
    | ""
    | "before-delete"
    | "after-delete"
    | "refuse-delete"
    | "unreadable",
};
const provider: PrivateBlobProvider = {
  id: "project-files-fixture",
  name: "Project file fixture",
  isConfigured: () => true,
  async put(input) {
    const id = `file-${randomUUID()}`;
    blobs.set(id, new Uint8Array(input.data));
    return { id, provider: this.id, opaque: true, encrypted: false };
  },
  async read(handle: PrivateBlobHandle) {
    if (storage.failure === "unreadable")
      throw new PrivateBlobError("Fixture unavailable", "unavailable");
    const data = blobs.get(handle.id);
    if (!data) throw new PrivateBlobError("Fixture blob missing", "not_found");
    return { data, handle };
  },
  async delete(handle) {
    if (storage.failure === "before-delete")
      throw new PrivateBlobError("Fixture unavailable", "unavailable");
    if (storage.failure === "refuse-delete" || storage.failure === "unreadable")
      return { deleted: false, provider: this.id };
    const deleted = blobs.delete(handle.id);
    if (storage.failure === "after-delete")
      throw new PrivateBlobError("Fixture lost acknowledgement", "unavailable");
    return { deleted, provider: this.id };
  },
};
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "project-files-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(directory, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "project-file-fixture-word");
  resetAppConfigForTests();
  await closeDbExec();
  registerPrivateBlobProvider(provider);
  await inWorkspace(() =>
    createProject({
      ownerEmail: "files-owner@example.test",
      orgId: access.orgId,
      projectId: "project-a",
    }),
  );
});
afterEach(() => {
  storage.failure = "";
  access.orgId = "files-org-a";
  access.denied = false;
});
afterAll(async () => {
  unregisterPrivateBlobProvider(provider.id);
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const inWorkspace = <T>(fn: () => Promise<T>) =>
  runWithRequestContext(
    { userEmail: "files-owner@example.test", orgId: access.orgId },
    fn,
  );
const payload = {
  projectId: "project-a",
  filename: "readme.txt",
  mimeType: "text/plain",
  dataBase64: Buffer.from("saved file bytes\n").toString("base64"),
};

it("persists file metadata through a database reopen and downloads exact private bytes", async () => {
  const created = await inWorkspace(() => uploadProjectFile(payload));
  await closeDbExec();
  expect(await inWorkspace(() => listProjectFiles("project-a"))).toEqual([
    created.file,
  ]);
  const read = await inWorkspace(() =>
    readProjectFile("project-a", created.file.id),
  );
  expect(Buffer.from(read.dataBase64, "base64").toString()).toBe(
    "saved file bytes\n",
  );
  expect(await inWorkspace(() => listProjectFiles("project-b"))).toEqual([]);
  access.orgId = "files-org-b";
  expect(await inWorkspace(() => listProjectFiles("project-a"))).toEqual([]);
  await expect(
    inWorkspace(() => readProjectFile("project-a", created.file.id)),
  ).rejects.toMatchObject({ statusCode: 404 });
  access.orgId = "files-org-a";
  await inWorkspace(() => trashProjectFile("project-a", created.file.id));
  expect(await inWorkspace(() => listProjectFiles("project-a"))).toEqual([]);
  await expect(
    inWorkspace(() => readProjectFile("project-a", created.file.id)),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(blobs.size).toBe(1);
});

it("rejects a denied project before writing private storage", async () => {
  access.denied = true;
  const count = blobs.size;
  try {
    await expect(inWorkspace(() => uploadProjectFile(payload))).rejects.toThrow(
      "Project access denied",
    );
  } finally {
    access.denied = false;
  }
  expect(blobs.size).toBe(count);
});

it("rejects oversized and empty files without writing storage", async () => {
  const count = blobs.size;
  for (const dataBase64 of [
    "",
    Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
  ]) {
    await expect(
      inWorkspace(() => uploadProjectFile({ ...payload, dataBase64 })),
    ).rejects.toMatchObject({ statusCode: 413 });
  }
  expect(blobs.size).toBe(count);
});

it("preserves files in project Trash and removes their metadata and private bytes on permanent deletion", async () => {
  const scope = { ownerEmail: "files-owner@example.test", orgId: access.orgId };
  const project = await inWorkspace(() =>
    createProject({ ...scope, title: "QA delete uploaded files" }),
  );
  const created = await inWorkspace(() =>
    uploadProjectFile({ ...payload, projectId: project.id }),
  );
  const before = new Map(blobs);
  await inWorkspace(() =>
    updateProject({ ...scope, projectId: project.id, trashed: true }),
  );
  expect(await inWorkspace(() => listProjectFiles(project.id))).toEqual([
    created.file,
  ]);
  expect(blobs).toEqual(before);
  await inWorkspace(() => deleteProjectPermanently(scope, project.id));
  expect(
    await inWorkspace(() =>
      resourceListContentByOwnersAndPrefixes(
        [scope.ownerEmail],
        [`project-files/${scope.orgId}/${project.id}/`],
        { orgId: scope.orgId },
      ),
    ),
  ).toEqual([]);
  expect(blobs.size).toBe(before.size - 1);
});

const ownerScope = () => ({
  ownerEmail: "files-owner@example.test",
  orgId: "files-org-a",
});
const metadataRows = (projectId: string, scope = ownerScope()) =>
  inWorkspace(() =>
    resourceListContentByOwnersAndPrefixes(
      [scope.ownerEmail],
      [`project-files/${scope.orgId}/${projectId}/`],
      { orgId: scope.orgId },
    ),
  );
async function uploadedProject() {
  const project = await inWorkspace(() =>
    createProject({ ...ownerScope(), title: "QA file cleanup" }),
  );
  await inWorkspace(() =>
    uploadProjectFile({ ...payload, projectId: project.id }),
  );
  await inWorkspace(() =>
    updateProject({ ...ownerScope(), projectId: project.id, trashed: true }),
  );
  return project;
}

it("repairs an already-deleted owned project's files and distinguishes a repeated absent result", async () => {
  const before = blobs.size;
  const project = await uploadedProject();
  await getDb()
    .delete(schema.projects)
    .where(eq(schema.projects.id, project.id));
  expect(
    await inWorkspace(() => purgeDeletedProjectFiles(ownerScope(), project.id)),
  ).toEqual({
    projectId: project.id,
    status: "purged",
    removedFiles: 1,
    retainedSharedAttachments: 0,
  });
  expect(await metadataRows(project.id)).toEqual([]);
  expect(blobs.size).toBe(before);
  expect(
    await inWorkspace(() => purgeDeletedProjectFiles(ownerScope(), project.id)),
  ).toEqual({
    projectId: project.id,
    status: "absent",
    removedFiles: 0,
    retainedSharedAttachments: 0,
  });
});

it("refuses repair while the owned project still exists, including Trash", async () => {
  const project = await uploadedProject();
  const before = new Map(blobs);
  await expect(
    inWorkspace(() => purgeDeletedProjectFiles(ownerScope(), project.id)),
  ).rejects.toMatchObject({
    errorCode: "project_file_cleanup_requires_deleted_project",
  });
  expect(await metadataRows(project.id)).toHaveLength(1);
  expect(blobs).toEqual(before);
  await inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id));
});

it("rejects corrupt metadata before deleting bytes and retains the trashed project for repair", async () => {
  const project = await uploadedProject();
  const [row] = await metadataRows(project.id);
  if (!row) throw new Error("Expected uploaded metadata");
  const before = new Map(blobs);
  await inWorkspace(() =>
    resourcePut(row.owner, row.path, "{broken", "application/json"),
  );
  await expect(
    inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id)),
  ).rejects.toMatchObject({ errorCode: "project_file_metadata_unreadable" });
  expect(
    await inWorkspace(() => getProjectDocument(ownerScope(), project.id)),
  ).not.toBeNull();
  expect(blobs).toEqual(before);
  await inWorkspace(() =>
    resourcePut(row.owner, row.path, row.content, "application/json"),
  );
  await inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id));
});

it.each(["before-delete", "refuse-delete", "unreadable"] as const)(
  "keeps the project and metadata retryable when private storage is %s",
  async (failure) => {
    const project = await uploadedProject();
    const rows = await metadataRows(project.id);
    const before = new Map(blobs);
    storage.failure = failure;
    await expect(
      inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id)),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(await metadataRows(project.id)).toEqual(rows);
    expect(blobs).toEqual(before);
    expect(
      await inWorkspace(() => getProjectDocument(ownerScope(), project.id)),
    ).not.toBeNull();
    storage.failure = "";
    await inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id));
    expect(await metadataRows(project.id)).toEqual([]);
    expect(
      await inWorkspace(() => getProjectDocument(ownerScope(), project.id)),
    ).toBeNull();
  },
);

it("resumes after private bytes were deleted but the provider acknowledgement was lost", async () => {
  const project = await uploadedProject();
  const rows = await metadataRows(project.id);
  const before = blobs.size;
  storage.failure = "after-delete";
  await expect(
    inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id)),
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(blobs.size).toBe(before - 1);
  expect(await metadataRows(project.id)).toEqual(rows);
  expect(
    await inWorkspace(() => getProjectDocument(ownerScope(), project.id)),
  ).not.toBeNull();
  storage.failure = "";
  await inWorkspace(() => deleteProjectPermanently(ownerScope(), project.id));
  expect(await metadataRows(project.id)).toEqual([]);
  expect(blobs.size).toBe(before - 1);
});

it("retains a shared attachment until the last project's file reference is removed", async () => {
  const before = blobs.size;
  const first = await uploadedProject();
  const second = await inWorkspace(() => createProject({ ...ownerScope() }));
  const [row] = await metadataRows(first.id);
  if (!row) throw new Error("Expected uploaded metadata");
  const metadata = storedProjectFileSchema.parse(JSON.parse(row.content));
  await inWorkspace(() =>
    resourcePut(
      row.owner,
      `project-files/files-org-a/${second.id}/${metadata.id}`,
      row.content,
      "application/json",
    ),
  );
  await inWorkspace(() => deleteProjectPermanently(ownerScope(), first.id));
  expect(await metadataRows(first.id)).toEqual([]);
  expect(blobs.size).toBe(before + 1);
  const files = await inWorkspace(() => listProjectFiles(second.id));
  const file = files[0];
  if (!file) throw new Error("Expected shared file");
  expect(
    await inWorkspace(() => readProjectFile(second.id, file.id)),
  ).toMatchObject({ text: "saved file bytes\n" });
  await inWorkspace(() =>
    updateProject({ ...ownerScope(), projectId: second.id, trashed: true }),
  );
  await inWorkspace(() => deleteProjectPermanently(ownerScope(), second.id));
  expect(blobs.size).toBe(before);
});

it("does not reveal or purge another owner or organization's files by project id", async () => {
  const project = await uploadedProject();
  await getDb()
    .delete(schema.projects)
    .where(eq(schema.projects.id, project.id));
  const rows = await metadataRows(project.id);
  const before = new Map(blobs);
  for (const scope of [
    { ...ownerScope(), ownerEmail: "other@example.test" },
    { ...ownerScope(), orgId: "files-org-b" },
  ]) {
    expect(
      await inWorkspace(() => purgeDeletedProjectFiles(scope, project.id)),
    ).toMatchObject({ status: "absent", removedFiles: 0 });
  }
  expect(await metadataRows(project.id)).toEqual(rows);
  expect(blobs).toEqual(before);
  await inWorkspace(() => purgeDeletedProjectFiles(ownerScope(), project.id));
});

it("refuses a forged metadata reference to another tenant's private bytes", async () => {
  const foreign = await inWorkspace(() =>
    mintAttachmentRef({
      data: Buffer.from("foreign fixture"),
      filename: "foreign.txt",
      mimeType: "text/plain",
      ownerEmail: "other@example.test",
      orgId: "files-org-b",
    }),
  );
  if (foreign.status !== "ok")
    throw new Error("Expected foreign fixture attachment");
  const id = randomUUID();
  await inWorkspace(() =>
    resourcePut(
      ownerScope().ownerEmail,
      `project-files/files-org-a/deleted-fixture/${id}`,
      JSON.stringify({
        id,
        filename: "foreign.txt",
        mimeType: "text/plain",
        bytes: 15,
        createdAt: new Date().toISOString(),
        ref: foreign.ref,
      }),
      "application/json",
    ),
  );
  const before = new Map(blobs);
  await expect(
    inWorkspace(() =>
      purgeDeletedProjectFiles(ownerScope(), "deleted-fixture"),
    ),
  ).rejects.toMatchObject({
    statusCode: 403,
    failure: { status: "forbiddenScope", reason: "owner_mismatch" },
  });
  expect(blobs).toEqual(before);
  expect(await metadataRows("deleted-fixture")).toHaveLength(1);
});
