import { readBoundedMultipartFormData } from "../icon-assets/multipart.js";
import {
  MAX_PRIVATE_MEDIA_BYTES,
  PrivateMediaValidationError,
} from "./store.js";

/** Room for the multipart boundaries and the other form fields. */
export const MAX_PRIVATE_MEDIA_MULTIPART_BYTES =
  MAX_PRIVATE_MEDIA_BYTES + 64 * 1024;

export function readPrivateMediaUploadFormData(
  request: Request,
): Promise<FormData> {
  return readBoundedMultipartFormData(
    request,
    MAX_PRIVATE_MEDIA_MULTIPART_BYTES,
    (statusCode) =>
      statusCode === 413
        ? new PrivateMediaValidationError(
            `Images can be up to ${MAX_PRIVATE_MEDIA_BYTES / 1024 / 1024} MB.`,
            413,
          )
        : new PrivateMediaValidationError("Invalid image upload.", 400),
  );
}
