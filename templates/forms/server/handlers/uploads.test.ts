import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  form: {
    id: "form-1",
    slug: "community-form",
    title: "Community form",
    fields: JSON.stringify([
      {
        id: "screenshots",
        type: "file",
        label: "Screenshots",
        required: false,
        multiple: true,
        accept: "image/png",
        maxSizeBytes: 100,
        maxFiles: 3,
      },
    ]),
    settings: JSON.stringify({ allowedOrigins: ["https://docs.example.com"] }),
    status: "published",
    deletedAt: null as string | null,
    ownerEmail: "forms-owner@builder.io",
    orgId: "builder-org",
  },
  identifier: "community-form",
  headers: {} as Record<string, string | undefined>,
  parts: [] as Array<{
    name?: string;
    filename?: string;
    type?: string;
    data: Buffer;
  }>,
  status: 200,
  responseHeaders: {} as Record<string, string>,
  requestContexts: [] as Array<Record<string, unknown>>,
}));

const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: (_event: unknown, name: string) =>
    state.headers[name.toLowerCase()],
  getRouterParam: () => state.identifier,
  readMultipartFormData: async () => state.parts,
  setResponseHeader: (_event: unknown, name: string, value: string) => {
    state.responseHeaders[name] = value;
  },
  setResponseStatus: (_event: unknown, status: number) => {
    state.status = status;
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({ uploadFile }));

vi.mock("@agent-native/core/server", () => ({
  isAllowedUploadMimeType: (mimeType: string) =>
    /^(image|video|audio|text)\//.test(mimeType) ||
    ["application/json", "application/pdf", "application/zip"].includes(
      mimeType,
    ),
  runWithRequestContext: async (
    context: Record<string, unknown>,
    callback: () => unknown,
  ) => {
    state.requestContexts.push(context);
    return callback();
  },
}));

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return {
    schema,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: async () => [state.form],
        }),
      }),
    }),
  };
});

const { uploadFormFile } = await import("./uploads.js");

function event() {
  return {} as any;
}

function setValidRequest() {
  state.identifier = "community-form";
  state.headers = {
    origin: "https://docs.example.com",
    "content-type": "multipart/form-data; boundary=test",
    "content-length": "256",
  };
  state.parts = [
    { name: "fieldId", data: Buffer.from("screenshots") },
    {
      name: "file",
      filename: "screen.png",
      type: "image/png",
      data: Buffer.from("png"),
    },
  ];
  state.status = 200;
  state.responseHeaders = {};
  state.requestContexts = [];
  uploadFile.mockReset();
  uploadFile.mockResolvedValue({
    url: "https://cdn.example.test/screen.png",
    id: "asset-1",
    provider: "builder",
  });
}

describe("public form file uploads", () => {
  beforeEach(setValidRequest);

  it("resolves a public identifier and uploads through the scoped core provider", async () => {
    const result = await uploadFormFile(event());

    expect(state.status).toBe(201);
    expect(state.responseHeaders).toEqual({
      "Access-Control-Allow-Origin": "https://docs.example.com",
      Vary: "Origin",
    });
    expect(state.requestContexts).toEqual([
      { userEmail: "forms-owner@builder.io", orgId: "builder-org" },
    ]);
    expect(uploadFile).toHaveBeenCalledWith({
      data: Buffer.from("png"),
      filename: "screen.png",
      mimeType: "image/png",
      ownerEmail: "forms-owner@builder.io",
      stableUrl: true,
      recordAsset: false,
    });
    expect(result).toEqual({
      url: "https://cdn.example.test/screen.png",
      name: "screen.png",
      type: "image/png",
      size: 3,
      id: "asset-1",
      provider: "builder",
    });
  });

  it("rejects a disallowed origin before reading or storing the file", async () => {
    state.headers.origin = "https://untrusted.example.com";

    const result = await uploadFormFile(event());

    expect(state.status).toBe(403);
    expect(result).toEqual({ error: "Origin not allowed" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("rejects oversized and disallowed files before provider upload", async () => {
    state.parts[1] = {
      name: "file",
      filename: "payload.exe",
      type: "application/x-msdownload",
      data: Buffer.alloc(101),
    };

    const result = await uploadFormFile(event());

    expect(state.status).toBe(413);
    expect(result).toEqual({ error: "File is too large" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("rejects files that fail the form accept filter", async () => {
    state.parts[1] = {
      name: "file",
      filename: "notes.txt",
      type: "text/plain",
      data: Buffer.from("notes"),
    };

    const result = await uploadFormFile(event());

    expect(state.status).toBe(415);
    expect(result).toEqual({ error: "File type is not accepted by this form" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("reports unavailable storage without returning file bytes as a fallback", async () => {
    uploadFile.mockResolvedValue(null);

    const result = await uploadFormFile(event());

    expect(state.status).toBe(503);
    expect(result).toMatchObject({
      error: expect.stringContaining("File storage is not configured"),
      storageSetupRequired: true,
    });
    expect(result).not.toHaveProperty("data");
  });

  it("rejects an invalid URL returned by the storage provider", async () => {
    uploadFile.mockResolvedValue({
      url: "data:image/png;base64,not-a-public-storage-url",
      provider: "builder",
    });

    const result = await uploadFormFile(event());

    expect(state.status).toBe(502);
    expect(result).toEqual({
      error: "File storage returned an invalid file URL",
    });
  });
});
