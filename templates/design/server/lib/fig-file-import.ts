/**
 * Server bindings for the isomorphic `.fig` conversion in
 * `shared/fig-to-frames.ts`: core's file upload, and the shared HTML document
 * normalizer. Everything else lives there so the browser can run it too.
 */

import { uploadFile } from "@agent-native/core/file-upload";

import {
  convertDecodedFigToEditableHtml as convertShared,
  importFigFileToEditableHtml as importShared,
  type FigFileImportResult,
  type ImageUploader,
} from "../../shared/fig-to-frames.js";
import type { DecodedFig } from "./fig-file-decoder.js";
import { normalizeImportedHtmlDocument } from "./import-design-files.js";

export type { FigFileImportResult, ImageUploader };

const serverUploader: ImageUploader = (input) =>
  uploadFile({ ...input, data: Buffer.from(input.data) });

export function convertDecodedFigToEditableHtml(
  decoded: DecodedFig,
  options: {
    originalName: string;
    ownerEmail: string;
    uploader?: ImageUploader;
  },
): Promise<FigFileImportResult> {
  return convertShared(decoded, {
    ...options,
    uploader: options.uploader ?? serverUploader,
    normalizeHtml: normalizeImportedHtmlDocument,
  });
}

export function importFigFileToEditableHtml(options: {
  data: Uint8Array;
  originalName: string;
  ownerEmail: string;
  uploader?: ImageUploader;
}): Promise<FigFileImportResult> {
  return importShared({
    ...options,
    uploader: options.uploader ?? serverUploader,
    normalizeHtml: normalizeImportedHtmlDocument,
  });
}
