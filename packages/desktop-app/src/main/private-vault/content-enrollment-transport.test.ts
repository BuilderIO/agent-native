import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentEnrollmentTransport,
  PrivateVaultContentEnrollmentTransportError,
} from "./content-enrollment-transport.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

const offerHash = "ab".repeat(32);
const offer = Uint8Array.of(1, 2, 3);
const challenge = Uint8Array.of(4, 5, 6);
const sasDecision = Uint8Array.of(10, 11, 12);
const authorization = Uint8Array.of(7, 8, 9);

function statusBody(phase: "offer" | "challenge" | "confirmed" | "committed") {
  return {
    version: 1,
    suite: "anc/v1",
    phase,
    offer: Buffer.from(offer).toString("base64url"),
    challenge:
      phase === "offer" ? null : Buffer.from(challenge).toString("base64url"),
    sasDecision:
      phase === "confirmed" || phase === "committed"
        ? Buffer.from(sasDecision).toString("base64url")
        : null,
    authorization:
      phase === "committed"
        ? Buffer.from(authorization).toString("base64url")
        : null,
    controlEntryId: phase === "committed" ? "11".repeat(16) : null,
    controlEntryHash: phase === "committed" ? "22".repeat(32) : null,
    expiresAt: "2026-07-18T18:10:00.000Z",
  };
}

function response(
  path: string,
  body: unknown,
  overrides: Partial<{
    status: number;
    url: string;
    contentType: string;
    contentLength: string;
  }> = {},
): Response {
  const encoded = Buffer.from(JSON.stringify(body));
  return {
    status: overrides.status ?? 200,
    url: overrides.url ?? `https://content-fork.example${path}`,
    redirected: false,
    headers: new Headers({
      "content-type": overrides.contentType ?? "application/json",
      "content-length": overrides.contentLength ?? String(encoded.byteLength),
    }),
    arrayBuffer: async () => encoded,
  } as unknown as Response;
}

describe("PrivateVaultContentEnrollmentTransport", () => {
  it("publishes exact ceremony bytes and follows the hosted status machine", async () => {
    const fetch = vi
      .fn<PrivateVaultContentSession["fetch"]>()
      .mockResolvedValueOnce(
        response("/api/private-vault/enrollment/offer", statusBody("offer")),
      )
      .mockResolvedValueOnce(
        response(
          `/api/private-vault/enrollment/${offerHash}/challenge`,
          statusBody("challenge"),
        ),
      )
      .mockResolvedValueOnce(
        response(
          `/api/private-vault/enrollment/${offerHash}/sas-decision`,
          statusBody("confirmed"),
        ),
      )
      .mockResolvedValueOnce(
        response(
          `/api/private-vault/enrollment/${offerHash}/authorization`,
          statusBody("committed"),
        ),
      );
    const transport = new PrivateVaultContentEnrollmentTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await expect(
      transport.publishOffer(offerHash, offer),
    ).resolves.toMatchObject({
      phase: "offer",
      challenge: null,
    });
    await expect(
      transport.publishChallenge(offerHash, offer, challenge),
    ).resolves.toMatchObject({ phase: "challenge", challenge });
    await expect(
      transport.publishSasDecision(offerHash, offer, sasDecision),
    ).resolves.toMatchObject({ phase: "confirmed", sasDecision });
    await expect(
      transport.publishAuthorization(offerHash, offer, authorization),
    ).resolves.toMatchObject({
      phase: "committed",
      authorization,
      controlEntryId: "11".repeat(16),
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://content-fork.example/api/private-vault/enrollment/offer",
      `https://content-fork.example/api/private-vault/enrollment/${offerHash}/challenge`,
      `https://content-fork.example/api/private-vault/enrollment/${offerHash}/sas-decision`,
      `https://content-fork.example/api/private-vault/enrollment/${offerHash}/authorization`,
    ]);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      credentials: "include",
      redirect: "error",
      headers: expect.objectContaining({
        "Content-Type":
          "application/vnd.agent-native.private-vault-enrollment+cbor",
        "X-Agent-Native-CSRF": "1",
      }),
    });
  });

  it("reads an exact status without trusting a separate vault coordinate", async () => {
    const path = `/api/private-vault/enrollment/${offerHash}/status`;
    const fetch = vi
      .fn<PrivateVaultContentSession["fetch"]>()
      .mockResolvedValue(response(path, statusBody("challenge")));
    const transport = new PrivateVaultContentEnrollmentTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await expect(transport.readStatus(offerHash, offer)).resolves.toMatchObject(
      {
        phase: "challenge",
        offer,
        challenge,
      },
    );
    expect(fetch).toHaveBeenCalledWith(
      `https://content-fork.example${path}`,
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("fails closed on transcript substitution, noncanonical status, or redirects", async () => {
    const path = "/api/private-vault/enrollment/offer";
    const substituted = statusBody("offer");
    substituted.offer = Buffer.from([9]).toString("base64url");
    const fetch = vi
      .fn<PrivateVaultContentSession["fetch"]>()
      .mockResolvedValueOnce(response(path, substituted))
      .mockResolvedValueOnce(
        response(path, { ...statusBody("offer"), extra: 1 }),
      )
      .mockResolvedValueOnce(
        response(path, statusBody("offer"), {
          url: "https://attacker.example/api/private-vault/enrollment/offer",
        }),
      );
    const transport = new PrivateVaultContentEnrollmentTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    for (let index = 0; index < 3; index += 1) {
      await expect(
        transport.publishOffer(offerHash, offer),
      ).rejects.toBeInstanceOf(PrivateVaultContentEnrollmentTransportError);
    }
  });
});
