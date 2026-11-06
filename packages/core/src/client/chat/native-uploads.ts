import type { AgentKitUploadDriver } from "@agent-native/agentkit";
import type { AgentTransport, FilePart } from "@agent-native/agentkit/protocol";
import { isPersistableAttachmentReferenceUrl } from "@agent-native/agentkit/protocol";

import { agentNativePath } from "../api-path.js";

export function fileUploadUrlForChatApi(apiUrl: string): string {
  return apiUrl.endsWith("/agent-chat")
    ? `${apiUrl.slice(0, -"/agent-chat".length)}/file-upload`
    : agentNativePath("/_agent-native/file-upload");
}

export function createAgentNativeUploadRuntime(
  options: {
    url?: string;
    fetch?: typeof fetch;
    headers?: (threadId: string) => Promise<Headers>;
  } = {},
) {
  const pending = new Map<string, { threadId: string; file?: FilePart }>();
  const fetcher = options.fetch ?? fetch;
  const url = options.url ?? agentNativePath("/_agent-native/file-upload");
  const failure = (code: string, status?: number) =>
    Object.assign(new Error(code), {
      code,
      retryable:
        code === "upload_network_error" ||
        status === 408 ||
        status === 429 ||
        (status !== undefined && status >= 500),
      ...(status === undefined ? {} : { status }),
    });
  const operations: Required<
    Pick<AgentTransport, "createUpload" | "completeUpload" | "cancelUpload">
  > = {
    async createUpload({ threadId, descriptor }) {
      if (descriptor.size > 25 * 1024 * 1024)
        throw failure("upload_too_large", 413);
      if (pending.size >= 100) throw failure("upload_unavailable", 429);
      const uploadId = `agent-upload-${crypto.randomUUID()}`;
      pending.set(uploadId, { threadId });
      return { uploadId, method: "POST", url, fields: {} };
    },
    async completeUpload({ threadId, uploadId }) {
      const entry = pending.get(uploadId);
      if (!entry || entry.threadId !== threadId || !entry.file)
        throw failure("upload_invalid_response");
      pending.delete(uploadId);
      return entry.file;
    },
    async cancelUpload({ threadId, uploadId }) {
      if (pending.get(uploadId)?.threadId === threadId)
        pending.delete(uploadId);
    },
  };
  const upload: AgentKitUploadDriver = async (target, file, context) => {
    const entry = pending.get(target.uploadId);
    if (!entry || target.url !== url) throw failure("upload_invalid_response");
    if (file.size > 25 * 1024 * 1024) throw failure("upload_too_large", 413);
    const requestHeaders = new Headers(await options.headers?.(entry.threadId));
    requestHeaders.delete("Content-Type");
    const form = new FormData();
    form.set("file", file.body, file.name);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: requestHeaders,
        body: form,
        ...(context?.signal ? { signal: context.signal } : {}),
      });
    } catch (cause) {
      if (context?.signal?.aborted) throw cause;
      throw Object.assign(failure("upload_network_error"), { cause });
    }
    if (!response.ok)
      throw failure(
        response.status === 413
          ? "upload_too_large"
          : response.status === 401 || response.status === 403
            ? "upload_session_expired"
            : response.status === 415
              ? "upload_unsupported_type"
              : response.status === 408 ||
                  response.status === 429 ||
                  response.status >= 500
                ? "upload_unavailable"
                : `upload_http_${response.status}`,
        response.status,
      );
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("url" in result) ||
      !isPersistableAttachmentReferenceUrl(result.url)
    )
      throw failure("upload_invalid_response");
    if (pending.get(target.uploadId) !== entry)
      throw failure("upload_invalid_response");
    entry.file = {
      type: "file",
      name: file.name,
      mediaType: file.mediaType,
      url: result.url,
      ...("id" in result && typeof result.id === "string"
        ? { fileId: result.id }
        : {}),
    };
  };
  return { operations, upload, dispose: () => pending.clear() };
}
