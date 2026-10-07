const CHAT_IMAGE_ATTACHMENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const CHAT_IMAGE_DATA_URL =
  /^data:image\/(?:gif|jpe?g|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

export interface VisualImageAttachment {
  type?: string;
  name?: string;
  filename?: string;
  originalName?: string;
  dataUrl?: string;
}

export class MissingVisualImagePayloadError extends Error {
  constructor() {
    super("A visual image attachment is missing its image data.");
    this.name = "MissingVisualImagePayloadError";
  }
}

export function isVisualImageAttachment(
  file: Pick<
    VisualImageAttachment,
    "type" | "name" | "filename" | "originalName"
  >,
): boolean {
  const type = file.type?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("image/svg")) return false;
  if (type.startsWith("image/")) return true;
  const name = file.originalName ?? file.filename ?? file.name ?? "";
  return /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/i.test(name);
}

export function isSupportedChatImageType(type: string): boolean {
  return CHAT_IMAGE_ATTACHMENT_TYPES.has(
    type.split(";", 1)[0]?.trim().toLowerCase() ?? "",
  );
}

export function imageAttachmentsFromUploadedFiles(
  files: readonly VisualImageAttachment[],
): string[] {
  const imageFiles = files.filter(isVisualImageAttachment);
  const images: string[] = [];
  for (const file of imageFiles) {
    const image = file.dataUrl?.trim();
    if (!image || !CHAT_IMAGE_DATA_URL.test(image)) {
      throw new MissingVisualImagePayloadError();
    }
    images.push(image);
  }
  return images;
}
