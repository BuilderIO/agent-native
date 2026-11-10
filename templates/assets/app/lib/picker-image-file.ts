/**
 * The host app's request for the file behind an image the user chose in the
 * embedded picker. A host keeps its own copy of a chosen image, so its readers
 * don't need access to this library to see it (Content copies it into the
 * page's own storage).
 */
export const PICKER_IMAGE_FILE_REQUEST = "imageFile";

/** An image the user chose in this picker: where its bytes are and its name. */
export interface ChosenPickerImage {
  url: string;
  title?: string | null;
  mimeType?: string | null;
}

export interface PickerImageFile {
  blob: Blob;
  filename: string;
  mimeType: string;
}

/**
 * Reads the file for `request.assetId`, but only for an image the user chose
 * in this picker: choosing it is what shares it with the host, so a host can't
 * read the rest of the library through this request.
 */
export async function readChosenPickerImage(
  chosen: ReadonlyMap<string, ChosenPickerImage>,
  request: unknown,
  fetchImage: typeof fetch = fetch,
): Promise<PickerImageFile> {
  const assetId =
    request && typeof request === "object"
      ? (request as { assetId?: unknown }).assetId
      : undefined;
  const image = typeof assetId === "string" ? chosen.get(assetId) : undefined;
  if (!image) {
    throw new Error("Only an image chosen in this picker can be read."); // i18n-ignore message to the host app, not shown here
  }
  const response = await fetchImage(image.url, {
    credentials: sameOrigin(image.url) ? "same-origin" : "omit",
  });
  if (!response.ok) {
    throw new Error(`The image could not be read (${response.status}).`); // i18n-ignore message to the host app, not shown here
  }
  const blob = await response.blob();
  const mimeType = blob.type || image.mimeType || "";
  if (!mimeType.startsWith("image/")) {
    throw new Error("The chosen asset is not an image."); // i18n-ignore message to the host app, not shown here
  }
  return {
    blob,
    filename: image.title?.trim() || String(assetId),
    mimeType,
  };
}

function sameOrigin(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
