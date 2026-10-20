import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  createDesignVersionSnapshot,
  readDesignVersionSnapshot,
} from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  resolveSourceWorkspace,
  writeInlineSourceFilesBatch,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import {
  COMPONENT_ARCHIVE_ATTR,
  componentDeletionGeometrySchema,
  deleteComponentMain,
  readComponentArchivePointer,
  restoreComponentMain,
  type ComponentArchivePointer,
  type ComponentArchiveTransformResult,
  type ComponentDeletionGeometry,
} from "../shared/component-archive.js";
import type {
  ComponentSourceChange,
  ComponentSourceDocument,
} from "../shared/component-links.js";
import { COMPONENT_REF_ATTR } from "../shared/component-model.js";
import { sourceContentHash } from "../shared/source-workspace.js";

export class ComponentArchiveMutationError extends Error {
  readonly statusCode = 409;
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "ComponentArchiveMutationError";
    this.reason = reason;
  }
}

interface LiveSourceFile {
  file: SourceWorkspaceFile;
  content: string;
  versionHash: string;
}

export interface ExpectedComponentArchiveFile {
  fileId: string;
  versionHash: string;
}

export interface ComponentArchiveSelection {
  fileId: string;
  nodeIds: string[];
}

export interface ComponentArchiveMutationResult {
  designId: string;
  componentId: string;
  mainNodeId: string;
  archive: ComponentArchivePointer;
  checkpointId: string;
  persisted: true;
  changes: Array<
    ComponentSourceChange & {
      beforeVersionHash: string;
      afterVersionHash: string;
      updatedAt: string;
    }
  >;
  referenceNodeIds: Array<{ fileId: string; nodeId: string }>;
  sourceBases: Array<{
    fileId: string;
    versionHash: string;
    updatedAt: string;
  }>;
  selection: ComponentArchiveSelection;
}

async function liveDesignFiles(designId: string): Promise<LiveSourceFile[]> {
  await assertAccess("design", designId, "editor");
  const workspace = await resolveSourceWorkspace(designId, {
    includeContent: true,
    includeBoard: true,
  });
  if (workspace.sourceType !== "inline") {
    throw new ComponentArchiveMutationError(
      "source-type",
      "Component archive mutations require inline design files.",
    );
  }
  const files = workspace.files.filter(
    (file) => file.fileType.toLowerCase() === "html",
  );
  return Promise.all(
    files.map(async (file) => ({ file, ...(await readLiveSourceFile(file)) })),
  );
}

function validateExpectedFiles(
  liveFiles: readonly LiveSourceFile[],
  expectedFiles: readonly ExpectedComponentArchiveFile[] | undefined,
): void {
  if (!expectedFiles) return;
  const expected = new Map(
    expectedFiles.map(({ fileId, versionHash }) => [fileId, versionHash]),
  );
  if (
    expected.size !== expectedFiles.length ||
    expected.size !== liveFiles.length ||
    liveFiles.some(
      ({ file, versionHash }) => expected.get(file.id) !== versionHash,
    )
  ) {
    throw new ComponentArchiveMutationError(
      "source-file-set-mismatch",
      "The editor source file set or one of its version hashes changed. Refresh the design and retry.",
    );
  }
}

function sourceDocuments(
  files: readonly LiveSourceFile[],
): ComponentSourceDocument[] {
  return files.map(({ file, content }) => ({
    source: {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    },
    content,
  }));
}

async function checkpointFile(args: {
  designId: string;
  versionId: string;
  fileId: string;
}) {
  const [version] = await getDb()
    .select({ snapshot: schema.designVersions.snapshot })
    .from(schema.designVersions)
    .where(
      and(
        eq(schema.designVersions.id, args.versionId),
        eq(schema.designVersions.designId, args.designId),
      ),
    )
    .limit(1);
  if (!version) {
    throw new ComponentArchiveMutationError(
      "snapshot-not-found",
      "The component archive checkpoint was not persisted.",
    );
  }
  const snapshot = await readDesignVersionSnapshot(
    version.snapshot,
    args.designId,
  );
  const file = snapshot.files.find((candidate) => candidate.id === args.fileId);
  if (!file) {
    throw new ComponentArchiveMutationError(
      "snapshot-file-not-found",
      "The component archive checkpoint does not contain the source file.",
    );
  }
  return { file, deletionGeometry: snapshot.deletionGeometry };
}

function validateDeletionGeometry(args: {
  geometry?: ComponentDeletionGeometry;
  target: LiveSourceFile;
  mainNodeId: string;
}): ComponentDeletionGeometry | undefined {
  if (!args.geometry) return undefined;
  const parsed = componentDeletionGeometrySchema.safeParse(args.geometry);
  if (
    !parsed.success ||
    parsed.data.fileId !== args.target.file.id ||
    parsed.data.mainNodeId !== args.mainNodeId ||
    parsed.data.sourceVersionHash !== args.target.versionHash
  ) {
    throw new ComponentArchiveMutationError(
      "invalid-deletion-geometry",
      "The component deletion geometry does not match the live source preimage.",
    );
  }
  return parsed.data;
}

async function verifiedDeleteCheckpoint(
  designId: string,
  target: LiveSourceFile,
  mainNodeId: string,
  deletionGeometry?: ComponentDeletionGeometry,
): Promise<{ id: string }> {
  const geometry = validateDeletionGeometry({
    geometry: deletionGeometry,
    target,
    mainNodeId,
  });
  const checkpoint = await createDesignVersionSnapshot(designId, {
    label: "Before component delete",
    ...(geometry ? { deletionGeometry: geometry } : {}),
  });
  const checkpointData = await checkpointFile({
    designId,
    versionId: checkpoint.id,
    fileId: target.file.id,
  });
  if (sourceContentHash(checkpointData.file.content) !== target.versionHash) {
    throw new ComponentArchiveMutationError(
      "snapshot-mismatch",
      "The component archive checkpoint does not match the live source preimage.",
    );
  }
  if (geometry && !checkpointData.deletionGeometry) {
    throw new ComponentArchiveMutationError(
      "snapshot-mismatch",
      "The component archive checkpoint did not preserve deletion geometry.",
    );
  }
  return { id: checkpoint.id };
}

function throwTransformRefusal(result: ComponentArchiveTransformResult): never {
  if (result.status === "updated") {
    throw new Error("Expected a component archive refusal.");
  }
  throw new ComponentArchiveMutationError(result.reason, result.message);
}

async function persistTransform(args: {
  designId: string;
  liveFiles: readonly LiveSourceFile[];
  result: Extract<ComponentArchiveTransformResult, { status: "updated" }>;
  checkpointId: string;
  selection: ComponentArchiveSelection;
}): Promise<ComponentArchiveMutationResult> {
  const changesByFile = new Map(
    args.result.changes.map((change) => [change.fileId, change.after]),
  );
  const files = args.liveFiles.map((live) => ({
    file: { ...live.file, content: live.content },
    content: changesByFile.get(live.file.id) ?? live.content,
    expectedVersionHash: live.versionHash,
  }));
  const persisted = await writeInlineSourceFilesBatch({
    designId: args.designId,
    files,
    expectedHtmlFileIds: args.liveFiles.map(({ file }) => file.id),
  });
  const persistedById = new Map(persisted.files.map((file) => [file.id, file]));
  return {
    designId: args.designId,
    componentId: args.result.componentId,
    mainNodeId: args.result.mainNodeId,
    archive: args.result.archive,
    checkpointId: args.checkpointId,
    persisted: true,
    changes: args.result.changes.map((change) => {
      const file = persistedById.get(change.fileId);
      if (!file) {
        throw new ComponentArchiveMutationError(
          "missing-persisted-file",
          `Source file "${change.fileId}" was not returned by the atomic writer.`,
        );
      }
      return {
        ...change,
        beforeVersionHash: sourceContentHash(change.before),
        afterVersionHash: file.versionHash,
        updatedAt: file.updatedAt,
      };
    }),
    referenceNodeIds: args.result.referenceNodeIds,
    sourceBases: persisted.files.map((file) => ({
      fileId: file.id,
      versionHash: file.versionHash,
      updatedAt: file.updatedAt,
    })),
    selection: args.selection,
  };
}

export async function deleteComponentMainFromDesign(args: {
  designId: string;
  fileId: string;
  mainNodeId: string;
  expectedVersionHash?: string;
  expectedFiles?: readonly ExpectedComponentArchiveFile[];
  deletionGeometry?: ComponentDeletionGeometry;
}): Promise<ComponentArchiveMutationResult> {
  const liveFiles = await liveDesignFiles(args.designId);
  validateExpectedFiles(liveFiles, args.expectedFiles);
  const target = liveFiles.find(({ file }) => file.id === args.fileId);
  if (!target) {
    throw new ComponentArchiveMutationError(
      "missing-file",
      `Source file "${args.fileId}" was not found in this design.`,
    );
  }
  if (
    args.expectedVersionHash &&
    args.expectedVersionHash !== target.versionHash
  ) {
    throw new ComponentArchiveMutationError(
      "source-hash-mismatch",
      "The selected component main changed before deletion.",
    );
  }
  const checkpoint = await verifiedDeleteCheckpoint(
    args.designId,
    target,
    args.mainNodeId,
    args.deletionGeometry,
  );
  const result = deleteComponentMain({
    documents: sourceDocuments(liveFiles),
    target: { fileId: args.fileId, nodeId: args.mainNodeId },
    archive: {
      schemaVersion: 1,
      versionId: checkpoint.id,
      fileId: args.fileId,
      mainNodeId: args.mainNodeId,
      sourceVersionHash: target.versionHash,
    },
  });
  if (result.status !== "updated") throwTransformRefusal(result);
  return persistTransform({
    designId: args.designId,
    liveFiles,
    result,
    checkpointId: checkpoint.id,
    selection: {
      fileId: args.fileId,
      nodeIds: [],
    },
  });
}

function archiveForInstance(args: {
  target: LiveSourceFile;
  instanceNodeId: string;
}): ComponentArchivePointer {
  const projection = buildCodeLayerProjection(args.target.content, {
    source: {
      kind: "design-file",
      designId: args.target.file.designId,
      fileId: args.target.file.id,
      filename: args.target.file.filename,
    },
  });
  const nodes = projection.nodes.filter(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === args.instanceNodeId,
  );
  if (nodes.length !== 1) {
    throw new ComponentArchiveMutationError(
      "missing-instance",
      "The selected component instance was not found uniquely.",
    );
  }
  const read = readComponentArchivePointer(
    nodes[0]!.dataAttributes[COMPONENT_ARCHIVE_ATTR],
  );
  if (read.status !== "valid") {
    throw new ComponentArchiveMutationError(
      "missing-archive",
      "The selected component instance has no valid restore pointer.",
    );
  }
  if (
    nodes[0]!.dataAttributes[COMPONENT_REF_ATTR] !== read.pointer.componentId
  ) {
    throw new ComponentArchiveMutationError(
      "invalid-archive-location",
      "The selected restore pointer is not on a linked instance root.",
    );
  }
  return read.pointer;
}

function sameArchivePointer(
  left: ComponentArchivePointer,
  right: ComponentArchivePointer,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.versionId === right.versionId &&
    left.fileId === right.fileId &&
    left.componentId === right.componentId &&
    left.mainNodeId === right.mainNodeId &&
    left.sourceVersionHash === right.sourceVersionHash
  );
}

export async function restoreComponentMainInDesign(args: {
  designId: string;
  fileId: string;
  instanceNodeId: string;
  archive?: ComponentArchivePointer;
  expectedVersionHash?: string;
  expectedFiles?: readonly ExpectedComponentArchiveFile[];
}): Promise<ComponentArchiveMutationResult> {
  const liveFiles = await liveDesignFiles(args.designId);
  validateExpectedFiles(liveFiles, args.expectedFiles);
  const target = liveFiles.find(({ file }) => file.id === args.fileId);
  if (!target) {
    throw new ComponentArchiveMutationError(
      "missing-file",
      `Source file "${args.fileId}" was not found in this design.`,
    );
  }
  if (
    args.expectedVersionHash &&
    args.expectedVersionHash !== target.versionHash
  ) {
    throw new ComponentArchiveMutationError(
      "source-hash-mismatch",
      "The selected component instance changed before restore.",
    );
  }
  const selectedArchive = archiveForInstance({
    target,
    instanceNodeId: args.instanceNodeId,
  });
  const archive = args.archive ?? selectedArchive;
  if (args.archive && !sameArchivePointer(args.archive, selectedArchive)) {
    throw new ComponentArchiveMutationError(
      "archive-mismatch",
      "The restore pointer does not belong to the selected component instance.",
    );
  }
  const checkpointData = await checkpointFile({
    designId: args.designId,
    versionId: archive.versionId,
    fileId: archive.fileId,
  });
  if (
    sourceContentHash(checkpointData.file.content) !== archive.sourceVersionHash
  ) {
    throw new ComponentArchiveMutationError(
      "snapshot-mismatch",
      "The restore checkpoint hash does not match its immutable source file.",
    );
  }
  const result = restoreComponentMain({
    documents: sourceDocuments(liveFiles),
    archived: {
      source: {
        kind: "design-file",
        designId: args.designId,
        fileId: checkpointData.file.id ?? archive.fileId,
        filename: checkpointData.file.filename,
      },
      content: checkpointData.file.content,
    },
    archive,
    deletionGeometry: checkpointData.deletionGeometry,
  });
  if (result.status !== "updated") throwTransformRefusal(result);
  const checkpoint = await createDesignVersionSnapshot(args.designId, {
    label: "Before component restore",
  });
  return persistTransform({
    designId: args.designId,
    liveFiles,
    result,
    checkpointId: checkpoint.id,
    selection: {
      fileId: archive.fileId,
      nodeIds: [archive.mainNodeId],
    },
  });
}
