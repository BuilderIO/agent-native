import { z } from "zod";

import { fail } from "../action.js";
import {
  extractCssColors,
  extractDominantColors,
  downscaleImageToFit,
} from "../ingestion/media.js";
import { parseOfficeDocument } from "../ingestion/office.js";
import { putPrivateBlob, readPrivateBlob } from "../private-blob/index.js";
import { encryptSecretValue, decryptSecretValue } from "../secrets/crypto.js";
import {
  designSystemArtifactSchema,
  type DesignSystemSourceInput,
} from "../shared/design-system-authoring.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export const DESIGN_SYSTEM_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const PREFIX = "design-system-upload:v1:";
const MIME_BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const descriptorSchema = z.object({
  ownerEmail: z.string(),
  orgId: z.string().nullable(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().min(1).max(DESIGN_SYSTEM_SOURCE_MAX_BYTES),
  blob: designSystemArtifactSchema.shape.content.unwrap(),
});

export async function storeDesignSystemSourceUpload(input: {
  name: string;
  data: Uint8Array;
}) {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail)
    return fail("Sign in before uploading sources.", {
      errorCode: "unauthorized",
      statusCode: 401,
    });
  const name = input.name.split(/[\\/]/).at(-1)?.trim();
  const extension = name?.split(".").at(-1)?.toLowerCase();
  const mimeType = extension ? MIME_BY_EXTENSION[extension] : undefined;
  if (!name || !mimeType)
    return fail(
      "Unsupported source format. Use design.md, text, CSS, JSON, an image, PDF, DOCX or PPTX.",
      { errorCode: "design_system_file_unsupported", statusCode: 415 },
    );
  if (
    !input.data.byteLength ||
    input.data.byteLength > DESIGN_SYSTEM_SOURCE_MAX_BYTES
  )
    return fail("Source files must contain 1 byte to 20 MiB.", {
      errorCode: "design_system_file_size",
      statusCode: 413,
    });
  const blob = await putPrivateBlob({
    data: input.data,
    filename: name,
    mimeType,
    ownerEmail,
    metadata: { kind: "design-system-source" },
  });
  if (!blob)
    return fail("Private file storage is not configured for source uploads.", {
      errorCode: "design_system_storage_unavailable",
      statusCode: 503,
    });
  const descriptor = {
    ownerEmail: ownerEmail.toLowerCase(),
    orgId: getRequestOrgId() ?? null,
    name,
    mimeType,
    size: input.data.byteLength,
    blob,
  };
  return {
    name,
    mimeType,
    size: input.data.byteLength,
    handle: {
      kind: "stored-file" as const,
      path: PREFIX + encryptSecretValue(JSON.stringify(descriptor)),
    },
  };
}

export async function readDesignSystemSourceUploadBytes(
  source: Extract<DesignSystemSourceInput, { kind: "file" }>,
): Promise<{ data: Uint8Array; name: string; mimeType: string; size: number }> {
  if (source.handle.kind === "builder-upload")
    return fail(
      "This Builder upload token cannot be verified or read by native authoring. Re-upload the source through Brand files; its reference has been retained.",
      { errorCode: "design_system_upload_unverifiable", statusCode: 409 },
    );
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail)
    return fail("Sign in to read source files.", {
      errorCode: "unauthorized",
      statusCode: 401,
    });
  if (!source.handle.path.startsWith(PREFIX))
    return fail(
      "This file reference is not a native design-system upload. Re-upload the file.",
      { errorCode: "design_system_upload_invalid", statusCode: 403 },
    );
  let descriptor: z.infer<typeof descriptorSchema>;
  try {
    descriptor = descriptorSchema.parse(
      JSON.parse(decryptSecretValue(source.handle.path.slice(PREFIX.length))),
    );
  } catch {
    return fail("The source upload reference is invalid.", {
      errorCode: "design_system_upload_invalid",
      statusCode: 403,
    });
  }
  if (
    descriptor.ownerEmail !== ownerEmail.toLowerCase() ||
    descriptor.orgId !== (getRequestOrgId() ?? null)
  )
    return fail(
      "This source upload is unavailable to the current user or organization.",
      { errorCode: "design_system_upload_forbidden", statusCode: 403 },
    );
  if (
    descriptor.name !== source.name ||
    descriptor.mimeType !== source.mimeType ||
    descriptor.size !== source.size
  )
    return fail("Source metadata does not match the uploaded file.", {
      errorCode: "design_system_upload_invalid",
      statusCode: 400,
    });
  const { data } = await readPrivateBlob(descriptor.blob);
  if (data.byteLength !== descriptor.size)
    return fail("The uploaded source is incomplete.", {
      errorCode: "design_system_upload_corrupt",
      statusCode: 422,
    });
  return {
    data,
    name: descriptor.name,
    mimeType: descriptor.mimeType,
    size: descriptor.size,
  };
}

export async function readDesignSystemSourceFile(
  source: Extract<DesignSystemSourceInput, { kind: "file" }>,
) {
  const { data, name, mimeType } =
    await readDesignSystemSourceUploadBytes(source);
  if (mimeType === "image/svg+xml") {
    const colors = extractCssColors(new TextDecoder().decode(data));
    if (!colors.length)
      return fail(
        "No usable color evidence was found in this SVG. Add written guidance or a raster reference.",
        { errorCode: "design_system_source_empty", statusCode: 422 },
      );
    return {
      evidence: `SVG paint values: ${colors.slice(0, 40).join(", ")}. Geometry and typography were not extracted.`,
      warnings: ["SVG paint values only; active markup is never rendered."],
      _agentImages: [],
    };
  }
  if (mimeType.startsWith("image/")) {
    const colors = await extractDominantColors(data);
    const image = await downscaleImageToFit({ data, maxBytes: 1400000 });
    if (!image)
      return fail("The image could not be decoded within the preview limit.", {
        errorCode: "design_system_image_unreadable",
        statusCode: 422,
      });
    return {
      evidence: `Image reference ${source.name}; extracted dominant colors: ${colors.join(", ")}. Color roles and typography require inference.`,
      warnings: [
        "Dominant colors are sampled image evidence, not semantic design tokens.",
      ],
      _agentImages: [
        {
          data: Buffer.from(image.data).toString("base64"),
          mediaType: image.mimeType,
        },
      ],
    };
  }
  if (["application/json", "text/css"].includes(mimeType)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data).trim();
    if (!text)
      return fail("The source contains no readable text.", {
        errorCode: "design_system_source_empty",
        statusCode: 422,
      });
    return {
      evidence: text.slice(0, 24000),
      warnings:
        text.length > 24000
          ? ["Source text truncated to 24,000 characters."]
          : [],
      _agentImages: [],
    };
  }
  const document = await parseOfficeDocument({
    data,
    fileName: name,
    mimeType,
  });
  if (!document.text.trim())
    return fail("No readable content was extracted from this file.", {
      errorCode: "design_system_source_empty",
      statusCode: 422,
    });
  return {
    evidence: document.text.slice(0, 24000),
    warnings: [
      ...document.warnings,
      ...(document.text.length > 24000
        ? ["Source text truncated to 24,000 characters."]
        : []),
    ],
    _agentImages: [],
  };
}
