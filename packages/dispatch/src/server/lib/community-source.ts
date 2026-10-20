import { createHash } from "node:crypto";

import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import type { BuilderAgentAttachment } from "@agent-native/core/server";

export interface PinnedCommunitySource {
  id: string;
  repo: string;
  ref: string;
  templatePath: string;
  files: readonly { path: string; blobSha: string }[];
}

const SOURCE_FILE_MAX_BYTES = 128 * 1024;
const SOURCE_TOTAL_MAX_BYTES = 64 * 1024;
const SOURCE_FETCH_TIMEOUT_MS = 10_000;

async function readSourceResponse(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > SOURCE_FILE_MAX_BYTES) {
    throw new Error("Pinned community source file exceeds the size limit.");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > SOURCE_FILE_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Pinned community source file exceeds the size limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function readPinnedSourceFile(
  source: PinnedCommunitySource,
  file: PinnedCommunitySource["files"][number],
  appId: string,
  fetchSource: typeof ssrfSafeFetch,
): Promise<{ attachment: BuilderAgentAttachment; size: number }> {
  // Blob hashes pin the content, so source commits need not survive squash merges.
  if (
    !/^[a-f0-9]{40}$/i.test(file.blobSha) ||
    source.ref !== "main" ||
    file.path.startsWith("/") ||
    file.path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Curated community source contains an invalid file pin.");
  }

  const fileUrl = `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${source.templatePath}/${file.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  let response: Response;
  try {
    response = await fetchSource(
      fileUrl,
      {
        headers: { Accept: "text/plain" },
        signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
      },
      {
        followRedirects: false,
        maxRedirects: 0,
        httpsOnly: true,
        assertUrlAllowed: (candidate) => {
          if (new URL(candidate).hostname !== "raw.githubusercontent.com") {
            throw new Error(
              "Curated community source redirected to an untrusted host.",
            );
          }
        },
      },
    );
  } catch (error) {
    throw new Error("Pinned community source network request failed.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(
      `Pinned community source file could not be loaded (${response.status}).`,
    );
  }

  let bytes: Buffer;
  let content: string;
  try {
    bytes = await readSourceResponse(response);
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("Pinned community source integrity check failed.", {
      cause: error,
    });
  }
  const blobSha = createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
  if (blobSha !== file.blobSha) {
    throw new Error("Pinned community source file failed its Git blob check.");
  }

  return {
    size: bytes.byteLength,
    attachment: {
      type: "upload",
      contentType: file.path.endsWith(".json")
        ? "application/json"
        : "text/plain",
      name: `${appId}/${file.path}`,
      text: content,
      dataUrl: "",
      id: `${source.id}:${file.path}`,
    },
  };
}

export async function loadPinnedCommunitySourceAttachments(
  source: PinnedCommunitySource,
  appId: string,
  fetchSource: typeof ssrfSafeFetch = ssrfSafeFetch,
): Promise<BuilderAgentAttachment[]> {
  if (source.ref !== "main" || source.files.length === 0) {
    throw new Error("Curated community source has no valid pinned file set.");
  }
  const files = await Promise.all(
    source.files.map((file) =>
      readPinnedSourceFile(source, file, appId, fetchSource),
    ),
  );
  if (
    files.reduce((total, file) => total + file.size, 0) > SOURCE_TOTAL_MAX_BYTES
  ) {
    throw new Error("Pinned community template exceeds the total size limit.");
  }
  return files.map(({ attachment }) => attachment);
}
