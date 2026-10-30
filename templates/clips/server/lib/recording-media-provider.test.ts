// oracle-change: Approved existing-API deletion is limited to new hidden uploads with recorded provenance; legacy objects and ambiguous serving state remain unconfirmed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CleanupPayload } from "./recording-media-lifecycle.js";
import type { MediaCleanupStep } from "./recording-media-provider.js";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/server", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "assets:write",
  resolveBuilderRequestAuthorization: auth,
}));
vi.mock("./s3-upload-provider.js", () => ({
  s3MediaCleanupFingerprint: vi.fn(),
}));
const { deleteBuilderMediaForCleanup } =
  await import("./recording-media-provider.js");
const id = "0123456789abcdef0123456789abcdef",
  space = "fake-space";
const url = `https://cdn.builder.io/o/assets%2F${space}%2F${id}?token=fake-token&alt=media`;
const registered = `https://cdn.builder.io/api/v1/file/assets/${space}/${id}?token=fake-registered`;
const object = {
  recordingId: "rec-1",
  ownerEmail: "owner@example.test",
  objectKey: `builder:${space}:${id}`,
  phase: "pending",
  payload: {
    urls: [url],
    builderUpload: {
      recordingId: "rec-1",
      ownerEmail: "owner@example.test",
      producerId: "fake-producer",
      objectKey: `builder:${space}:${id}`,
    },
  },
};
beforeEach(() => {
  vi.restoreAllMocks();
  auth.mockResolvedValue({
    source: "oauth",
    authorization: "Bearer fake-oauth",
    oauthSelectedPublicKey: space,
    oauthConnectionId: "fake-connection",
  });
});
describe("Builder deletion evidence", () => {
  it.each([
    {
      source: "oauth",
      authorization: "Bearer fake-oauth",
      oauthSelectedPublicKey: space,
    },
    {
      source: "legacy",
      authorization: "Bearer fake-pat",
      legacyPublicKey: space,
    },
    {
      source: "legacy",
      authorization: "Bearer fake-space-key",
      legacyPublicKey: space,
    },
  ])(
    "registers proven hidden uploads using $authorization and waits before serving checks",
    async (authorization) => {
      auth.mockResolvedValue(authorization);
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id, url: registered }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetcher);
      const steps: MediaCleanupStep[] = [];
      const checkpoint = async (step: MediaCleanupStep) => {
        steps.push(step);
      };
      const first = await deleteBuilderMediaForCleanup(object, checkpoint);
      expect(first).toMatchObject({
        phase: "pending",
        reason: "awaiting_serving_verification",
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const registration = fetcher.mock.calls.find(
        ([, init]) => init.method === "POST",
      );
      const deletion = fetcher.mock.calls.find(
        ([, init]) => init.method === "DELETE",
      );
      if (!registration || !deletion)
        throw new Error("Expected registration and deletion");
      expect(new URL(registration[0]).searchParams.get("apiKey")).toBe(space);
      expect(JSON.parse(registration[1].body)).toEqual({
        assetId: id,
        recordAsset: true,
        skipCompression: true,
      });
      expect(new URL(deletion[0]).searchParams.get("url")).toBe(registered);
      expect(steps.map((s) => s.phase)).toEqual([
        "register_sent",
        "registered",
        "delete_sent",
        "provider_accepted",
      ]);
      const accepted = {
        ...object,
        phase: "provider_accepted",
        payload: { ...object.payload, ...first.payload },
      };
      await deleteBuilderMediaForCleanup(accepted, checkpoint);
      expect(fetcher).toHaveBeenCalledTimes(2);
      now.mockReturnValue(1_121_000);
      fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
      expect(
        await deleteBuilderMediaForCleanup(accepted, checkpoint),
      ).toMatchObject({
        phase: "pending",
        reason: "serving_state_unconfirmed",
      });
      expect(fetcher).toHaveBeenLastCalledWith(
        url,
        expect.objectContaining({ method: "GET" }),
      );
    },
  );
  it.each([200, 206, 403, 404, 410, 500])(
    "classifies stored-URL %s only after the cache interval",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetcher);
      const result = await deleteBuilderMediaForCleanup(
        {
          ...object,
          phase: "provider_accepted",
          payload: { ...object.payload, acceptedAt: Date.now() - 120_001 },
        },
        vi.fn(),
      );
      expect(result.phase).toBe(
        status === 404 || status === 410 ? "complete" : "pending",
      );
      expect(fetcher).toHaveBeenLastCalledWith(
        url,
        expect.objectContaining({
          method: "GET",
          headers: { Range: "bytes=0-0" },
        }),
      );
    },
  );
  it("keeps legacy files blocked even if their metadata says a delete was accepted", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      await deleteBuilderMediaForCleanup(
        {
          ...object,
          phase: "provider_accepted",
          payload: { urls: [url], acceptedAt: 1 },
        },
        vi.fn(),
      ),
    ).toMatchObject({
      phase: "blocked",
      reason: "deletion_ownership_unconfirmed",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects another space before any provider operation", async () => {
    auth.mockResolvedValue({
      source: "legacy",
      authorization: "Bearer fake-key",
      legacyPublicKey: "other-space",
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await deleteBuilderMediaForCleanup(object, vi.fn())).toMatchObject({
      phase: "blocked",
      reason: "credential_space_mismatch",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("recovers the exact registered URL after losing the delete response without exposing its error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id, url: registered }))
      .mockRejectedValueOnce(new Error("fake-secret-body"));
    vi.stubGlobal("fetch", fetcher);
    let saved: CleanupPayload | undefined;
    const checkpoint = async (step: MediaCleanupStep) => {
      if (step.payload) saved = step.payload;
    };
    expect(await deleteBuilderMediaForCleanup(object, checkpoint)).toEqual({
      phase: "pending",
      reason: "provider_unavailable",
    });
    expect(saved?.registeredUrl).toBe(registered);
    if (!saved) throw new Error("Expected durable registered reference");
    fetcher.mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(
      await deleteBuilderMediaForCleanup(
        { ...object, phase: "delete_sent", payload: saved },
        checkpoint,
      ),
    ).toMatchObject({
      phase: "pending",
      reason: "awaiting_serving_verification",
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
