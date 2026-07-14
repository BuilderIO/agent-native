import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPutPrivateBlob = vi.hoisted(() => vi.fn());
const mockReadPrivateBlob = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockGetRequestContext = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: (...args: unknown[]) => mockPutPrivateBlob(...args),
  readPrivateBlob: (...args: unknown[]) => mockReadPrivateBlob(...args),
}));

vi.mock("@agent-native/core/secrets/crypto", () => ({
  encryptSecretValue: (value: string) =>
    Buffer.from(value, "utf8").toString("base64url"),
  decryptSecretValue: (value: string) =>
    Buffer.from(value, "base64url").toString("utf8"),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
  getRequestOrgId: (...args: unknown[]) => mockGetRequestOrgId(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

import {
  isHostedSlidesRuntime,
  readUploadedReferenceBlob,
  storeUploadedReferenceBlob,
} from "./uploaded-reference-storage";

const HANDLE = {
  id: "blob-1",
  provider: "test",
  opaque: true as const,
  encrypted: true,
};

describe("Slides uploaded reference storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPutPrivateBlob.mockResolvedValue(HANDLE);
    mockReadPrivateBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      handle: HANDLE,
    });
    mockGetRequestContext.mockReturnValue({
      orgId: "existing-org",
      timezone: "UTC",
    });
    mockGetRequestOrgId.mockReturnValue("existing-org");
    mockRunWithRequestContext.mockImplementation(
      (_context: unknown, fn: () => unknown) => fn(),
    );
  });

  it("recognizes hosted runtimes without treating local development as hosted", () => {
    expect(isHostedSlidesRuntime("/workspace/slides", {})).toBe(false);
    expect(isHostedSlidesRuntime("/var/task", {})).toBe(true);
    expect(
      isHostedSlidesRuntime("/workspace/slides", { NETLIFY: "true" }),
    ).toBe(true);
    expect(
      isHostedSlidesRuntime("/workspace/slides", {
        NETLIFY: "true",
        NETLIFY_LOCAL: "true",
      }),
    ).toBe(false);
    expect(
      isHostedSlidesRuntime("/workspace/slides", { NETLIFY: "false" }),
    ).toBe(false);
    expect(isHostedSlidesRuntime("/workspace/slides", { RENDER: "true" })).toBe(
      true,
    );
    expect(
      isHostedSlidesRuntime("/workspace/slides", { K_SERVICE: "slides" }),
    ).toBe(true);
  });

  it("stores and reads an encrypted owner-scoped private blob reference", async () => {
    const reference = await storeUploadedReferenceBlob({
      email: "owner@example.com",
      filename: "deck.pptx",
      data: new Uint8Array([1, 2, 3]),
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    expect(reference).toMatch(/^slides-upload:v1:/);
    expect(mockPutPrivateBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        filename: "deck.pptx",
      }),
    );
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: "owner@example.com",
        orgId: "existing-org",
        timezone: "UTC",
      }),
      expect.any(Function),
    );
    await expect(
      readUploadedReferenceBlob(reference!, "owner@example.com"),
    ).resolves.toEqual({
      data: Buffer.from([1, 2, 3]),
      filename: "deck.pptx",
    });
  });

  it("uses an explicitly supplied org for org-scoped upload providers", async () => {
    const reference = await storeUploadedReferenceBlob({
      email: "owner@example.com",
      orgId: "session-org",
      filename: "deck.pptx",
      data: new Uint8Array([1]),
      mimeType: "application/octet-stream",
    });

    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "session-org" }),
      expect.any(Function),
    );

    mockGetRequestOrgId.mockReturnValue("session-org");
    await expect(
      readUploadedReferenceBlob(reference!, "owner@example.com"),
    ).resolves.toEqual({
      data: Buffer.from([1, 2, 3]),
      filename: "deck.pptx",
    });
  });

  it("rejects another user's reference before reading the provider", async () => {
    const reference = await storeUploadedReferenceBlob({
      email: "owner@example.com",
      filename: "deck.pptx",
      data: new Uint8Array([1]),
      mimeType: "application/octet-stream",
    });
    mockReadPrivateBlob.mockClear();

    await expect(
      readUploadedReferenceBlob(reference!, "other@example.com"),
    ).rejects.toThrow("Access denied");
    expect(mockReadPrivateBlob).not.toHaveBeenCalled();
  });

  it("rejects another organization's reference before reading the provider", async () => {
    const reference = await storeUploadedReferenceBlob({
      email: "owner@example.com",
      orgId: "org-one",
      filename: "deck.pptx",
      data: new Uint8Array([1]),
      mimeType: "application/octet-stream",
    });
    mockReadPrivateBlob.mockClear();
    mockGetRequestOrgId.mockReturnValue("org-two");

    await expect(
      readUploadedReferenceBlob(reference!, "owner@example.com"),
    ).rejects.toThrow("Access denied");
    expect(mockReadPrivateBlob).not.toHaveBeenCalled();
  });

  it("keeps personal uploads outside organization scopes", async () => {
    mockGetRequestContext.mockReturnValue({ timezone: "UTC" });
    mockGetRequestOrgId.mockReturnValue(undefined);
    const reference = await storeUploadedReferenceBlob({
      email: "owner@example.com",
      orgId: null,
      filename: "deck.pptx",
      data: new Uint8Array([1]),
      mimeType: "application/octet-stream",
    });

    await expect(
      readUploadedReferenceBlob(reference!, "owner@example.com"),
    ).resolves.toEqual({
      data: Buffer.from([1, 2, 3]),
      filename: "deck.pptx",
    });

    mockReadPrivateBlob.mockClear();
    mockGetRequestOrgId.mockReturnValue("org-one");
    await expect(
      readUploadedReferenceBlob(reference!, "owner@example.com"),
    ).rejects.toThrow("Access denied");
    expect(mockReadPrivateBlob).not.toHaveBeenCalled();
  });

  it("rejects tampered references", async () => {
    await expect(
      readUploadedReferenceBlob(
        "slides-upload:v1:not-valid",
        "owner@example.com",
      ),
    ).rejects.toThrow("Invalid uploaded file reference");
  });
});
