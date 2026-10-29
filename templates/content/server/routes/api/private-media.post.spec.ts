import {
  MAX_PRIVATE_MEDIA_MULTIPART_BYTES,
  PrivateMediaStorageUnavailableError,
  PrivateMediaValidationError,
} from "@agent-native/core/private-media";
import { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  putPrivateMedia: vi.fn(),
  resolveEditablePrivateIconOrgId: vi.fn(),
  bindUploadedPrivateMedia: vi.fn(),
}));
vi.mock("@agent-native/core/private-media", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/private-media")
  >()),
  putPrivateMedia: mocks.putPrivateMedia,
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("../../lib/private-icon-target.js", () => ({
  resolveEditablePrivateIconOrgId: mocks.resolveEditablePrivateIconOrgId,
}));
vi.mock("../../lib/private-media-references.js", () => ({
  bindUploadedPrivateMedia: mocks.bindUploadedPrivateMedia,
  privateMediaPath: (id: string) => `/api/private-media/${id}`,
}));

import handler from "./private-media.post.js";

const MEDIA_ID = "00000000-0000-4000-8000-000000000001";

function upload(fields: Array<[string, string | File]>) {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  return new H3Event(
    new Request("https://content.example.test/api/private-media", {
      method: "POST",
      body: form,
    }),
  );
}

const image = () =>
  new File([Uint8Array.of(1, 2)], "shot.png", { type: "image/png" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({
    email: "owner@example.test",
    orgId: "org-1",
  });
  mocks.resolveEditablePrivateIconOrgId.mockResolvedValue("org-1");
  mocks.putPrivateMedia.mockResolvedValue({ id: MEDIA_ID });
});

describe("Content private image upload", () => {
  it("stores the image in the page's workspace and binds it to the page", async () => {
    const event = upload([
      ["documentId", "document-1"],
      ["file", image()],
    ]);
    await expect(handler(event)).resolves.toEqual({
      id: MEDIA_ID,
      url: `/api/private-media/${MEDIA_ID}`,
    });
    expect(event.res.status).toBe(201);
    expect(mocks.resolveEditablePrivateIconOrgId).toHaveBeenCalledWith(
      "document-1",
    );
    expect(mocks.putPrivateMedia).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      data: Uint8Array.of(1, 2),
      mimeType: "image/png",
      filename: "shot.png",
    });
    expect(mocks.bindUploadedPrivateMedia).toHaveBeenCalledWith({
      documentId: "document-1",
      mediaId: MEDIA_ID,
    });
  });

  it("requires a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(
      handler(
        upload([
          ["documentId", "document-1"],
          ["file", image()],
        ]),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
  });

  it.each([
    [[["file", image()]]],
    [
      [
        ["documentId", "document-1"],
        ["documentId", "document-2"],
        ["file", image()],
      ],
    ],
    [[["documentId", "document-1"]]],
  ] as Array<[Array<[string, string | File]>]>)(
    "refuses a request without exactly one page and one file (%#)",
    async (fields) => {
      await expect(handler(upload(fields))).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mocks.resolveEditablePrivateIconOrgId).not.toHaveBeenCalled();
      expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
    },
  );

  it("stores nothing when the caller cannot edit the page", async () => {
    mocks.resolveEditablePrivateIconOrgId.mockRejectedValue(
      Object.assign(new Error("Requires editor role"), { statusCode: 403 }),
    );
    await expect(
      handler(
        upload([
          ["documentId", "document-1"],
          ["file", image()],
        ]),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
    expect(mocks.bindUploadedPrivateMedia).not.toHaveBeenCalled();
  });

  it.each([
    [new PrivateMediaValidationError("Wrong type", 415), 415],
    [new PrivateMediaStorageUnavailableError(), 503],
  ])("answers a refused image with its status (%#)", async (error, status) => {
    mocks.putPrivateMedia.mockRejectedValue(error);
    await expect(
      handler(
        upload([
          ["documentId", "document-1"],
          ["file", image()],
        ]),
      ),
    ).rejects.toMatchObject({ statusCode: status });
    expect(mocks.bindUploadedPrivateMedia).not.toHaveBeenCalled();
  });

  it("cancels an oversized body before resolving its page", async () => {
    const cancel = vi.fn();
    const request = new Request(
      "https://content.example.test/api/private-media",
      {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(MAX_PRIVATE_MEDIA_MULTIPART_BYTES + 1),
            );
          },
          cancel,
        }),
        duplex: "half",
        headers: {
          "content-type": "multipart/form-data; boundary=example-boundary",
        },
      } as RequestInit,
    );
    await expect(handler(new H3Event(request))).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.resolveEditablePrivateIconOrgId).not.toHaveBeenCalled();
    expect(mocks.putPrivateMedia).not.toHaveBeenCalled();
  });
});
