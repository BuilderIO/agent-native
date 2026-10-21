import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
import QRCode from "qrcode";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const hexColor = z
  .string()
  .regex(/^#[\da-f]{6}$/i, "Use a six-digit hex color");

export default defineAction({
  description:
    "Generate a public PNG or SVG QR code image for a URL or text and return its HTTPS URL. Anyone with the URL can view the image.",
  schema: z.object({
    content: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .describe("URL or text to encode; up to 4096 characters"),
    format: z
      .enum(["png", "svg"])
      .default("png")
      .describe('Image format: "png" or "svg"; defaults to "png"'),
    size: z.coerce
      .number()
      .int()
      .min(100)
      .max(2048)
      .default(256)
      .describe("Image width in pixels, from 100 to 2048; defaults to 256"),
    margin: z.coerce
      .number()
      .int()
      .min(0)
      .max(16)
      .default(2)
      .describe("Quiet-zone margin in QR modules, from 0 to 16; defaults to 2"),
    fgColor: hexColor
      // guard:allow-raw-color — QR foreground output defaults to black for reliable scanning.
      .default("#000000")
      // guard:allow-raw-color — the documented QR foreground format includes its default value.
      .describe("Foreground color as #RRGGBB; defaults to #000000"),
    bgColor: hexColor
      // guard:allow-raw-color — QR background output defaults to white for reliable scanning.
      .default("#ffffff")
      // guard:allow-raw-color — the documented QR background format includes its default value.
      .describe("Background color as #RRGGBB; defaults to #ffffff"),
  }),
  http: { method: "POST" },
  requiresAuth: true,
  readOnly: false,
  run: async (args, ctx) => {
    const options = {
      width: args.size,
      margin: args.margin,
      color: { dark: args.fgColor, light: args.bgColor },
      errorCorrectionLevel: "H" as const,
    };
    let data: Buffer;
    let mimeType: string;

    try {
      if (args.format === "svg") {
        const svg = await QRCode.toString(args.content, {
          ...options,
          type: "svg",
        });
        data = Buffer.from(svg, "utf8");
        mimeType = "image/svg+xml";
      } else {
        data = await QRCode.toBuffer(args.content, options);
        mimeType = "image/png";
      }
    } catch {
      fail("The supplied content could not be encoded as a QR code.", {
        errorCode: "invalid_qr_content",
        statusCode: 400,
      });
    }

    const ownerEmail = ctx?.userEmail?.trim() || undefined;
    const upload = await uploadFile({
      data,
      filename: `${randomUUID()}.${args.format}`,
      mimeType,
      ...(ownerEmail ? { ownerEmail } : {}),
      recordAsset: false,
    });

    if (!upload) {
      fail(
        "File storage is not configured. Connect a file upload provider and try again.",
        {
          errorCode: "file_storage_unavailable",
          statusCode: 503,
        },
      );
    }

    let publicUrl: URL;
    try {
      publicUrl = new URL(upload.url);
    } catch {
      fail("The file upload provider returned an invalid artifact URL.", {
        errorCode: "invalid_artifact_url",
        statusCode: 502,
      });
    }
    if (
      publicUrl.protocol !== "https:" ||
      publicUrl.username.length > 0 ||
      publicUrl.password.length > 0
    ) {
      fail(
        "The file upload provider must return a public HTTPS artifact URL.",
        {
          errorCode: "invalid_artifact_url",
          statusCode: 502,
        },
      );
    }

    const historySaved = Boolean(ownerEmail);
    if (ownerEmail) {
      await getDb()
        .insert(schema.qrHistory)
        .values({
          id: randomUUID(),
          ownerEmail,
          label: args.content.slice(0, 40),
          content: args.content,
          fgColor: args.fgColor,
          bgColor: args.bgColor,
          format: args.format,
          size: args.size,
          margin: args.margin,
          createdAt: new Date().toISOString(),
        });
    }

    return {
      message: `Generated a public ${args.format.toUpperCase()} QR code image: ${upload.url}. Anyone with the URL can fetch it.`,
      url: upload.url,
      mimeType,
      format: args.format,
      fgColor: args.fgColor,
      bgColor: args.bgColor,
      size: args.size,
      margin: args.margin,
      byteSize: data.byteLength,
      content: args.content,
      historySaved,
    };
  },
});
