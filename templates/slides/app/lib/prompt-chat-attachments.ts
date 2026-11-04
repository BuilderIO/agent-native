import { readFileAsDataUrl } from "@/lib/image-drop-to-agent";
import type { UploadedFile } from "@/lib/prompt-file-uploads";

export interface PromptChatAttachment {
  type: "file";
  name: string;
  contentType?: string;
  displayOnly?: true;
  data?: string;
  text?: string;
}
export async function createPromptChatAttachments(
  attachments: ReadonlyArray<unknown> | undefined,
  uploaded: UploadedFile[],
): Promise<PromptChatAttachment[]> {
  const result: PromptChatAttachment[] = [];
  let uploadedIndex = 0;

  for (const raw of attachments ?? []) {
    const attachment = raw as {
      name?: unknown;
      contentType?: unknown;
      file?: File;
    };
    const name =
      typeof attachment.name === "string"
        ? attachment.name
        : attachment.file?.name;
    if (!name) continue;

    if (name.startsWith("pasted-text-")) {
      let text: string | undefined;
      try {
        text = await attachment.file?.text();
      } catch {
        text = undefined;
      }
      result.push({
        type: "file",
        name,
        contentType:
          typeof attachment.contentType === "string"
            ? attachment.contentType
            : "text/plain",
        displayOnly: true,
        ...(text !== undefined ? { text } : {}),
      });
      continue;
    }

    const uploadedFile = uploaded[uploadedIndex++];
    const isImage =
      uploadedFile?.type.startsWith("image/") ||
      Boolean(attachment.file?.type.startsWith("image/"));
    if (uploadedFile && isImage && (uploadedFile.url || uploadedFile.dataUrl)) {
      continue;
    }
    const file = attachment.file;
    if (
      file &&
      (file.type.startsWith("text/") ||
        /\.(txt|md|markdown|html?|csv|json)$/i.test(file.name))
    ) {
      result.push({
        type: "file",
        name,
        contentType: file.type || "text/plain",
        data: await readFileAsDataUrl(file),
      });
      continue;
    }
    result.push({
      type: "file",
      name: uploadedFile?.originalName ?? name,
      contentType:
        uploadedFile?.type ??
        (typeof attachment.contentType === "string"
          ? attachment.contentType
          : undefined),
      displayOnly: true,
    });
  }

  return result;
}
