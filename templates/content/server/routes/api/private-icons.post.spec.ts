import { MAX_ICON_MULTIPART_BYTES } from "@agent-native/core/icon-assets";
import { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  uploadPrivateIcon: vi.fn(),
  resolveEditablePrivateIconOrgId: vi.fn(),
}));
vi.mock(
  "@agent-native/core/icon-assets",
  async () =>
    await import("../../../../../packages/core/src/icon-assets/multipart.js"),
);
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("../../lib/private-icon-authority.js", () => ({
  uploadPrivateIcon: mocks.uploadPrivateIcon,
}));
vi.mock("../../lib/private-icon-target.js", () => ({
  resolveEditablePrivateIconOrgId: mocks.resolveEditablePrivateIconOrgId,
}));

import handler from "./private-icons.post.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({
    email: "owner@example.test",
    orgId: "org-1",
  });
  mocks.resolveEditablePrivateIconOrgId.mockResolvedValue(null);
  mocks.uploadPrivateIcon.mockResolvedValue(
    "00000000-0000-4000-8000-000000000001",
  );
});

describe("Content private icon upload", () => {
  it("preserves the document target, filename and personal scope for ordinary multipart without content length", async () => {
    const form = new FormData();
    form.set("documentId", "document-1");
    form.set(
      "file",
      new File([Uint8Array.of(1, 2)], "logo.png", { type: "image/png" }),
    );
    await expect(
      handler(
        new H3Event(
          new Request("https://content.example.test/api/private-icons", {
            method: "POST",
            body: form,
          }),
        ),
      ),
    ).resolves.toEqual({ id: "00000000-0000-4000-8000-000000000001" });
    expect(mocks.resolveEditablePrivateIconOrgId).toHaveBeenCalledWith(
      "document-1",
    );
    expect(mocks.uploadPrivateIcon).toHaveBeenCalledWith({
      data: Uint8Array.of(1, 2),
      filename: "logo.png",
      mimeType: "image/png",
      ownerEmail: "owner@example.test",
      orgId: null,
    });
  });

  it.each([undefined, "1"])(
    "cancels an oversized streamed body with declared length %s before resolving its target or writing",
    async (length) => {
      const cancel = vi.fn();
      const req = new Request(
        "https://content.example.test/api/private-icons",
        {
          method: "POST",
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_ICON_MULTIPART_BYTES + 1));
            },
            cancel,
          }),
          duplex: "half",
          headers: {
            "content-type": "multipart/form-data; boundary=example-boundary",
            ...(length ? { "content-length": length } : {}),
          },
        } as RequestInit,
      );
      await expect(handler(new H3Event(req))).rejects.toMatchObject({
        statusCode: 413,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(mocks.resolveEditablePrivateIconOrgId).not.toHaveBeenCalled();
      expect(mocks.uploadPrivateIcon).not.toHaveBeenCalled();
    },
  );
});
