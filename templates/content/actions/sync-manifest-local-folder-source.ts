import { defineAction } from "@agent-native/core";
import {
  getLocalArtifactApp,
  listConfiguredLocalArtifactFiles,
  readConfiguredLocalArtifactFile,
  type LocalArtifactOptions,
} from "@agent-native/core/local-artifacts";
import { z } from "zod";

import { parseContentSourceFile } from "../shared/content-source.js";
import connectLocalFolderSource from "./connect-local-folder-source.js";
import syncLocalFolderSource from "./sync-local-folder-source.js";

const CONTENT_LOCAL_DEFAULTS: LocalArtifactOptions["defaults"] = {
  roots: [],
  components: "components",
  hide: ["**/_*.md", "**/_*.mdx"],
};

function localOptions(): LocalArtifactOptions {
  return { appId: "content", defaults: CONTENT_LOCAL_DEFAULTS };
}

export default defineAction({
  description:
    "Bootstrap a manifest-declared local-folder source through the trusted local server bridge into normal SQL-backed Content.",
  schema: z.object({
    connectionId: z.string().min(1).max(300),
    file: z.string().optional(),
    spaceId: z.string().optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  run: async ({ connectionId, file, spaceId, dryRun }) => {
    const options = localOptions();
    const app = await getLocalArtifactApp(options);
    const root = app.roots.find(
      (candidate) =>
        candidate.source?.type === "local-folder" &&
        candidate.source.connectionId === connectionId,
    );
    if (!root) {
      throw new Error(
        `Local folder connection "${connectionId}" is not declared in agent-native.json`,
      );
    }
    const source = root.source;
    if (!source || source.type !== "local-folder") {
      throw new Error(`Local folder connection "${connectionId}" is invalid`);
    }
    const metadata = (await listConfiguredLocalArtifactFiles(options)).filter(
      (candidate) => candidate.rootPath === root.path,
    );
    const files: Record<string, string> = {};
    for (const candidate of metadata) {
      const loaded = await readConfiguredLocalArtifactFile({
        ...options,
        path: candidate.path,
      });
      if (loaded) files[candidate.path] = loaded.content;
    }
    if (file && !Object.prototype.hasOwnProperty.call(files, file)) {
      throw new Error(`Local file "${file}" is not in the configured folder`);
    }
    const connection = await connectLocalFolderSource.run({
      connectionId,
      label: root.name,
      spaceId,
      createSourceBackedSpace: !spaceId,
      truthPolicy: source.truthPolicy ?? "source_primary",
      dryRun,
    });
    if (!connection.connected || !connection.sourceId) {
      const parsed = Object.entries(files).map(([path, content]) =>
        parseContentSourceFile(path, content),
      );
      const valid = parsed.filter((candidate) => !candidate.errors?.length);
      return {
        sourceId: null,
        spaceId: null,
        filesDatabaseId: null,
        truthPolicy: source.truthPolicy ?? "source_primary",
        dryRun: true,
        filesSeen: parsed.length,
        created: valid.map((candidate) => ({
          id: candidate.id ?? "",
          path: candidate.path,
          title: candidate.title,
        })),
        updated: [],
        unchanged: [],
        conflicts: [],
        outbound: [],
        skipped: parsed.flatMap((candidate) =>
          candidate.errors?.length
            ? [{ path: candidate.path, reason: candidate.errors.join(" ") }]
            : [],
        ),
        errors: parsed.flatMap((candidate) =>
          candidate.errors?.length
            ? [{ path: candidate.path, reason: candidate.errors.join(" ") }]
            : [],
        ),
        idByPath: Object.fromEntries(
          valid.map((candidate) => [candidate.path, candidate.id ?? ""]),
        ),
        connectionId,
        requestedFile: file ?? null,
        requestedDocumentId: null,
      };
    }
    const result = await syncLocalFolderSource.run({
      sourceId: connection.sourceId,
      files,
      dryRun,
    });
    return {
      ...result,
      connectionId,
      requestedFile: file ?? null,
      requestedDocumentId: file ? (result.idByPath[file] ?? null) : null,
    };
  },
});
