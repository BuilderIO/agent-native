import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUploadFile = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mockUploadFile,
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: async (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mockValues }),
  }),
  schema: { uploadedAssets: {} },
}));

import { canSaveAsUploadedAsset, uploadImageAsset } from "./assets";
import { uploadedAssetUrlForBasePath } from "./assets-url";

beforeEach(() => {
  mockUploadFile.mockReset();
  mockUploadFile.mockResolvedValue({
    provider: "builder",
    url: "https://cdn.builder.io/logo.svg",
  });
  mockValues.mockReset();
  mockValues.mockResolvedValue(undefined);
});

describe("uploadedAssetUrl", () => {
  it("returns root-relative upload URLs without a configured base path", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "")).toBe(
      "/uploads/logo.png",
    );
  });

  it("prefixes upload URLs with APP_BASE_PATH", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "/slides/")).toBe(
      "/slides/uploads/logo.png",
    );
  });
});

describe("uploaded asset validation", () => {
  it("allows SVG assets", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "logo.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedAsset({
        originalName: "preamble.svg",
        data: Buffer.from(
          '<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg" />',
        ),
      }),
    ).toBe(true);
  });

  it("rejects SVGs with active content or external references", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "script.svg",
        data: Buffer.from('<svg onload="alert(1)" />'),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "remote.svg",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "unquoted-remote.svg",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href=https://example.com/x.png /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "namespaced-script.svg",
        data: Buffer.from(
          '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "encoded-css.svg",
        data: Buffer.from(
          "<svg><style>&#64;import&#32;url&#40;https://example.com/style.css&#41;;</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "escaped-css.svg",
        data: Buffer.from(
          "<svg><style>u\\72l(https://example.com/style.css){}</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "escaped-newline-css.svg",
        data: Buffer.from(
          "<svg><style>url(https://example.com/font\\" +
            "\n.woff2)</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "image-set-css.svg",
        data: Buffer.from(
          '<svg><style>rect{fill:image-set("https://example.com/pixel" 1x)}</style><rect /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "image-css.svg",
        data: Buffer.from(
          '<svg><style>rect{fill:image("https://example.com/pixel")}</style><rect /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "animate-transform.svg",
        data: Buffer.from(
          '<svg><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "commented-css.svg",
        data: Buffer.from(
          '<svg><style>@im/**/port "https://example.com/style.css";</style></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "xml-base.svg",
        data: Buffer.from(
          '<svg xml:base="https://example.com/"><use href="#icon" /></svg>',
        ),
      }),
    ).toBe(false);
  });

  it("normalizes SVG MIME before sending it to the upload provider", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "logo.svg",
        data: svg,
        type: "application/octet-stream",
      }),
    ).resolves.toMatchObject({ type: "image/svg+xml" });

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: svg,
        filename: "logo.svg",
        mimeType: "image/svg+xml",
        ownerEmail: "owner@example.com",
      }),
    );
  });
});
