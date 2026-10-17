import { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ICON_MULTIPART_BYTES } from "../icon-assets/multipart.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getOrgContext: vi.fn(),
  getSession: vi.fn(),
  putIconAsset: vi.fn(),
  getIconAsset: vi.fn(),
  readIconAssetForAuthorizedReference: vi.fn(),
  uploadFederatedWorkspaceIcon: vi.fn(),
  verifyFederatedWorkspaceIconOwner: vi.fn(),
  readFederatedWorkspaceIcon: vi.fn(),
  validateFederatedOrganizationMembership: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../server/auth.js", () => ({ getSession: mocks.getSession }));
vi.mock("./context.js", () => ({ getOrgContext: mocks.getOrgContext }));
vi.mock("./federation.js", () => ({
  validateFederatedOrganizationMembership:
    mocks.validateFederatedOrganizationMembership,
}));
vi.mock("../icon-assets/index.js", async () => ({
  ...(await import("../icon-assets/multipart.js")),
  putIconAsset: mocks.putIconAsset,
  getIconAsset: mocks.getIconAsset,
  readIconAssetForAuthorizedReference:
    mocks.readIconAssetForAuthorizedReference,
}));
vi.mock("../icon-assets/workspace-transport.js", () => ({
  uploadFederatedWorkspaceIcon: mocks.uploadFederatedWorkspaceIcon,
  verifyFederatedWorkspaceIconOwner: mocks.verifyFederatedWorkspaceIconOwner,
  readFederatedWorkspaceIcon: mocks.readFederatedWorkspaceIcon,
}));

import {
  readWorkspacePrivateIconHandler,
  uploadWorkspacePrivateIconHandler,
} from "./private-icon-handlers.js";

const assetId = "12345678-1234-4234-8234-123456789abc";
const image = { version: 1, kind: "image", authority: "private-icon", assetId };
const event = (path: string) =>
  new H3Event(new Request(`https://app.example.test${path}`));

function uploadEvent(
  mimeType = "image/png",
  filename = "logo.png",
  data = Uint8Array.of(1, 2),
) {
  const form = new FormData();
  form.set("file", new File([data], filename, { type: mimeType }));
  return new H3Event(
    new Request("https://app.example.test/", { method: "POST", body: form }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrgContext.mockResolvedValue({
    email: "owner@example.test",
    orgId: "org-1",
    role: "owner",
  });
  mocks.getSession.mockResolvedValue({ email: "member@example.test" });
  mocks.putIconAsset.mockResolvedValue({ id: assetId });
  mocks.getIconAsset.mockResolvedValue({ id: assetId });
  mocks.readIconAssetForAuthorizedReference.mockResolvedValue({
    data: new Uint8Array([1, 2]),
    mimeType: "image/png",
  });
  mocks.validateFederatedOrganizationMembership.mockResolvedValue({
    active: true,
    role: "member",
  });
});

describe("workspace private icons", () => {
  it.each([undefined, "1"])(
    "rejects a body over the byte budget with declared length %s before storage",
    async (length) => {
      mocks.execute.mockResolvedValueOnce({
        rows: [
          {
            identity_authority: null,
            identity_id: null,
            allowed_domain: null,
            icon_json: null,
          },
        ],
      });
      const cancel = vi.fn();
      const req = new Request("https://app.example.test/", {
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
      } as RequestInit);
      await expect(
        uploadWorkspacePrivateIconHandler(new H3Event(req)),
      ).rejects.toMatchObject({ statusCode: 413 });
      expect(cancel).toHaveBeenCalledOnce();
      expect(mocks.putIconAsset).not.toHaveBeenCalled();
      expect(mocks.uploadFederatedWorkspaceIcon).not.toHaveBeenCalled();
    },
  );

  it("uploads a private icon only for an organization administrator", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          identity_authority: null,
          identity_id: null,
          allowed_domain: null,
          icon_json: null,
        },
      ],
    });
    const request = uploadEvent();
    await expect(
      uploadWorkspacePrivateIconHandler(request as never),
    ).resolves.toEqual({ id: assetId });
    expect(mocks.putIconAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.test",
        orgId: "org-1",
      }),
    );

    mocks.getOrgContext.mockResolvedValueOnce({
      email: "member@example.test",
      orgId: "org-1",
      role: "member",
    });
    await expect(
      uploadWorkspacePrivateIconHandler(request as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.putIconAsset).toHaveBeenCalledTimes(1);
  });

  it("stores a federated workspace upload at the identity authority", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          identity_authority: "https://dispatch.example.test",
          identity_id: "canonical-org",
          allowed_domain: null,
          icon_json: null,
        },
      ],
    });
    mocks.uploadFederatedWorkspaceIcon.mockResolvedValueOnce(assetId);
    const request = uploadEvent();
    await expect(
      uploadWorkspacePrivateIconHandler(request as never),
    ).resolves.toEqual({ id: assetId });
    expect(mocks.uploadFederatedWorkspaceIcon).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ identityId: "canonical-org" }),
      "owner@example.test",
      expect.objectContaining({ filename: "logo.png" }),
    );
    expect(mocks.putIconAsset).not.toHaveBeenCalled();
  });

  it("accepts sanitized SVG storage and serves it with a sandbox policy", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          identity_authority: null,
          identity_id: null,
          allowed_domain: null,
          icon_json: null,
        },
      ],
    });
    const upload = uploadEvent(
      "image/svg+xml",
      "logo.svg",
      new TextEncoder().encode("<svg></svg>"),
    );
    await expect(
      uploadWorkspacePrivateIconHandler(upload as never),
    ).resolves.toEqual({ id: assetId });
    expect(mocks.putIconAsset).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/svg+xml" }),
    );

    mocks.getSession.mockResolvedValueOnce({ email: "member@example.test" });
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            identity_authority: null,
            identity_id: null,
            allowed_domain: null,
            icon_json: JSON.stringify(image),
          },
        ],
      });
    mocks.readIconAssetForAuthorizedReference.mockResolvedValueOnce({
      data: new TextEncoder().encode("<svg></svg>"),
      mimeType: "image/svg+xml",
    });
    const read = event(`/_agent-native/org/private-icons/org-1/${assetId}`);
    await expect(
      readWorkspacePrivateIconHandler(read as never),
    ).resolves.toBeInstanceOf(Buffer);
    expect(read.res.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
  });

  it("serves the exact referenced icon to an organization member", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            identity_authority: null,
            identity_id: null,
            allowed_domain: null,
            icon_json: JSON.stringify(image),
          },
        ],
      });
    const request = event(`/_agent-native/org/private-icons/org-1/${assetId}`);
    await expect(
      readWorkspacePrivateIconHandler(request as never),
    ).resolves.toEqual(Buffer.from([1, 2]));
    expect(request.res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("denies nonmembers and unreferenced asset IDs before reading bytes", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    await expect(
      readWorkspacePrivateIconHandler(
        event(`/_agent-native/org/private-icons/org-1/${assetId}`) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.readIconAssetForAuthorizedReference).not.toHaveBeenCalled();

    mocks.execute
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            identity_authority: null,
            identity_id: null,
            allowed_domain: null,
            icon_json: null,
          },
        ],
      });
    await expect(
      readWorkspacePrivateIconHandler(
        event(`/_agent-native/org/private-icons/org-1/${assetId}`) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.readIconAssetForAuthorizedReference).not.toHaveBeenCalled();
  });

  it("limits unassigned library previews to an administrator's own assets", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ role: "member" }] });
    await expect(
      readWorkspacePrivateIconHandler(
        event(
          `/_agent-native/org/private-icons/library/org-1/${assetId}`,
        ) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.getIconAsset).not.toHaveBeenCalled();

    mocks.execute
      .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            identity_authority: null,
            identity_id: null,
            allowed_domain: null,
            icon_json: null,
          },
        ],
      });
    mocks.getIconAsset.mockResolvedValueOnce(null);
    await expect(
      readWorkspacePrivateIconHandler(
        event(
          `/_agent-native/org/private-icons/library/org-1/${assetId}`,
        ) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.readIconAssetForAuthorizedReference).not.toHaveBeenCalled();
  });

  it("checks federated membership before proxying the referenced bytes", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            identity_authority: "https://dispatch.example.test",
            identity_id: "canonical-org",
            allowed_domain: null,
            icon_json: JSON.stringify(image),
          },
        ],
      });
    mocks.readFederatedWorkspaceIcon.mockResolvedValueOnce({
      data: new Uint8Array([3]),
      mimeType: "image/png",
    });
    await expect(
      readWorkspacePrivateIconHandler(
        event(`/_agent-native/org/private-icons/org-1/${assetId}`) as never,
      ),
    ).resolves.toEqual(Buffer.from([3]));
    expect(mocks.validateFederatedOrganizationMembership).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org-1", email: "member@example.test" },
    );
    expect(mocks.readFederatedWorkspaceIcon).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ identityId: "canonical-org" }),
      "member@example.test",
      assetId,
    );
  });
});
