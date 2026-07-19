import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  createPrivateVaultNativeServiceClient,
  createPrivateVaultNativeServiceClientForTest,
  PrivateVaultNativeServiceClientError,
} from "./native-service-client";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(currentDirectory, "..", "..", "..");
const nativeRoot = join(desktopRoot, "native", "private-vault-xpc-client");
const nativeSource = readFileSync(join(nativeRoot, "addon.mm"), "utf8");
const serviceRoot = join(desktopRoot, "native", "private-vault-service");
const webviewPreloadSource = readFileSync(
  join(desktopRoot, "src", "preload", "webview.ts"),
  "utf8",
);
const serviceSource = readFileSync(join(serviceRoot, "main.m"), "utf8");
const serviceIdentity = readFileSync(
  join(serviceRoot, "PrivateVaultServiceIdentity.h"),
  "utf8",
);
const wrapperSource = readFileSync(
  join(currentDirectory, "native-service-client.ts"),
  "utf8",
);
const buildSource = readFileSync(
  join(desktopRoot, "native", "build-private-vault-xpc-client.sh"),
  "utf8",
);

function clientFor(value: unknown) {
  return createPrivateVaultNativeServiceClientForTest(async () => ({
    request: vi.fn(async () => value),
  }));
}

describe("Private Vault native service client", () => {
  it("does not expose object plaintext operations to remote app webviews", () => {
    expect(webviewPreloadSource).not.toContain("sealObject");
    expect(webviewPreloadSource).not.toContain("openObject");
    expect(webviewPreloadSource).not.toContain("SEAL_OBJECT");
    expect(webviewPreloadSource).not.toContain("OPEN_OBJECT");
  });

  it("normalizes the exact health, lock, and unlock service contracts", async () => {
    await expect(
      clientFor({
        version: 3,
        operation: "health",
        state: "locked",
        available: true,
        rotationAckState: "idle",
      }).health(),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "health",
      state: "locked",
      available: true,
      ready: true,
      unlocked: false,
      rotationAckState: "idle",
    });
    await expect(
      clientFor({ version: 3, operation: "lock", state: "locked" }).lock(),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "lock",
      state: "locked",
    });
    const vaultId = "00112233445566778899aabbccddeeff";
    const request = vi.fn(async () => ({
      version: 3,
      operation: "unlock",
      state: "unlocked",
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(client.unlock(vaultId)).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "unlock",
      state: "unlocked",
    });
    expect(request).toHaveBeenCalledWith("unlock", vaultId);
    await expect(client.unlock("not-a-vault")).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("binds rotation resume to one exact vault and proof tuple", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const request = vi.fn(async () => ({
      version: 3,
      operation: "resume_rotation",
      state: "consumed",
      vaultId,
      custodyGeneration: 3,
      activeEpoch: 5,
      sequence: 20,
      headHash: "ab".repeat(32),
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(client.resumeRotation(vaultId)).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "resume_rotation",
      state: "consumed",
      vaultId,
      custodyGeneration: 3,
      activeEpoch: 5,
      sequence: 20,
      headHash: "ab".repeat(32),
    });
    expect(request).toHaveBeenCalledWith("resume_rotation", vaultId);
    await expect(client.resumeRotation(vaultId.toUpperCase())).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    expect(request).toHaveBeenCalledTimes(1);

    for (const mutation of [
      { headHash: "AB".repeat(32) },
      { vaultId: "ff".repeat(16) },
      { custodyGeneration: 0 },
      { activeEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { extra: true },
    ]) {
      const malformed = createPrivateVaultNativeServiceClientForTest(
        async () => ({
          request: vi.fn(async () => ({
            version: 3,
            operation: "resume_rotation",
            state: "consumed",
            vaultId,
            custodyGeneration: 3,
            activeEpoch: 5,
            sequence: 20,
            headHash: "ab".repeat(32),
            ...mutation,
          })),
        }),
      );
      await expect(malformed.resumeRotation(vaultId)).rejects.toEqual(
        new PrivateVaultNativeServiceClientError(),
      );
    }
  });

  it("keeps enrollment decisions inside the trusted native operation", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const challenge = new Uint8Array([0xa1, 0x01, 0x03]);
    const sasDecision = new Uint8Array([0xa1, 0x01, 0x05]);
    const authorization = new Uint8Array([0xa1, 0x01, 0x04]);
    const request = vi.fn(async (operation: string) => {
      if (operation === "prepare_enroll") {
        return {
          version: 3,
          operation,
          state: "offered",
          vaultId,
          candidateEndpointId: "11".repeat(16),
          offerHash: "22".repeat(32),
          offer: Buffer.from([0xa1, 0x01, 0x01]),
          candidateKeyProof: Buffer.alloc(64, 3),
        };
      }
      if (operation === "challenge_enroll") {
        return {
          version: 3,
          operation,
          state: "challenged",
          vaultId,
          challenge: Buffer.from(challenge),
        };
      }
      if (operation === "confirm_enroll") {
        return {
          version: 3,
          operation,
          state: "confirmed",
          sasDecision: Buffer.from(sasDecision),
        };
      }
      if (operation === "authorize_enroll") {
        return {
          version: 3,
          operation,
          state: "authorized",
          vaultId,
          authorization: Buffer.from(authorization),
        };
      }
      return {
        version: 3,
        operation: "activate_enroll",
        state: "active",
        vaultId,
        custodyGeneration: 3,
        activeEpoch: 1,
        sequence: 1,
        headHash: "44".repeat(32),
      };
    });
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));

    await expect(
      client.prepareBrokerEnrollment(vaultId),
    ).resolves.toMatchObject({
      operation: "prepare_enroll",
      state: "offered",
      vaultId,
    });
    await expect(
      client.buildBrokerEnrollmentChallenge({
        vaultId,
        offer: new Uint8Array([0xa1, 0x01, 0x01]),
        candidateKeyProof: new Uint8Array(64).fill(3),
      }),
    ).resolves.toEqual({ encoded: challenge });
    await expect(
      client.confirmBrokerEnrollment(vaultId, challenge),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "confirm_enroll",
      state: "confirmed",
      sasDecision,
    });
    await expect(
      client.buildBrokerEnrollmentAuthorization({
        vaultId,
        offer: new Uint8Array([0xa1, 0x01, 0x01]),
        challenge,
        sasDecision,
      }),
    ).resolves.toEqual({ encoded: authorization });
    await expect(
      client.activateBrokerEnrollment(vaultId, challenge, authorization),
    ).resolves.toMatchObject({
      operation: "activate_enroll",
      state: "active",
      custodyGeneration: 3,
    });

    expect(request.mock.calls.map(([operation]) => operation)).toEqual([
      "prepare_enroll",
      "challenge_enroll",
      "confirm_enroll",
      "authorize_enroll",
      "activate_enroll",
    ]);
    expect(nativeSource).toContain('"inspect_enroll"');
    expect(nativeSource).toContain('"decide_enroll"');
    expect(wrapperSource).not.toContain('addon.request("inspect_enroll"');
    expect(wrapperSource).not.toContain('addon.request("decide_enroll"');
    expect(wrapperSource).toMatch(/addon\.request\(\s*"challenge_enroll"/u);
    expect(wrapperSource).toContain('"authorize_enroll",');
    expect(nativeSource).toContain("PVTrustedEnrollmentPresentSAS(");
    expect(nativeSource).not.toContain('PVSetString(env, result, "sasCode"');
    expect(nativeSource).not.toContain(
      'PVSetBuffer(env, result, "sasTranscriptHash"',
    );

    const leakingClient = createPrivateVaultNativeServiceClientForTest(
      async () => ({
        request: vi.fn(async () => ({
          version: 3,
          operation: "challenge_enroll",
          state: "challenged",
          vaultId,
          challenge,
          sasCode: "056-775-976",
        })),
      }),
    );
    await expect(
      leakingClient.buildBrokerEnrollmentChallenge({
        vaultId,
        offer: new Uint8Array([0xa1, 0x01, 0x01]),
        candidateKeyProof: new Uint8Array(64).fill(1),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultNativeServiceClientError);
  });

  it("seals and opens Content revisions only through the native endpoint boundary", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const objectId = "11223344556677889900aabbccddeeff";
    const revisionId = Buffer.alloc(32, 7);
    const writerEndpointId = Buffer.alloc(16, 8);
    const ciphertext = Buffer.from([0xa4, 0x01, 0x02, 0x03]);
    const plaintext = Uint8Array.from(Buffer.from('{"title":"Moon"}'));
    const transferred: Buffer[] = [];
    const request = vi.fn(
      async (
        operation: string,
        ...arguments_: Array<string | number | Buffer>
      ) => {
        transferred.push(arguments_.at(-1) as Buffer);
        if (operation === "seal_object") {
          return {
            version: 3,
            operation,
            state: "sealed",
            vaultId,
            objectId,
            contentType: arguments_[3],
            revision: arguments_[2],
            epoch: 7,
            plaintextLength: plaintext.byteLength,
            revisionId,
            objectPayload: ciphertext,
          };
        }
        return {
          version: 3,
          operation: "open_object",
          state: "opened",
          vaultId,
          objectId,
          contentType: "application/vnd.agent-native.content-document+json",
          revision: 3,
          epoch: 7,
          plaintextLength: plaintext.byteLength,
          revisionId,
          writerEndpointId,
          objectPayload: Buffer.from(plaintext),
        };
      },
    );
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));

    const sealed = await client.sealContentObjectRevision({
      vaultId,
      objectId,
      revision: 3,
      plaintext,
    });
    expect(sealed).toMatchObject({
      operation: "seal_object",
      state: "sealed",
      vaultId,
      objectId,
      revision: 3,
      epoch: 7,
      plaintextLength: plaintext.byteLength,
    });
    expect(sealed.encodedRevision).toEqual(Uint8Array.from(ciphertext));
    const opened = await client.openContentObjectRevision({
      vaultId,
      objectId,
      revision: 3,
      encodedRevision: ciphertext,
    });
    expect(opened).toMatchObject({
      operation: "open_object",
      state: "opened",
    });
    expect(opened.writerEndpointId).toEqual(Uint8Array.from(writerEndpointId));
    expect(opened.plaintext).toEqual(plaintext);
    expect(request.mock.calls[0]).toEqual([
      "seal_object",
      vaultId,
      objectId,
      3,
      "application/vnd.agent-native.content-document+json",
      expect.any(Buffer),
    ]);
    expect(request.mock.calls[1]).toEqual([
      "open_object",
      vaultId,
      objectId,
      3,
      expect.any(Buffer),
    ]);
    await expect(
      client.sealContentObjectRevision({
        vaultId,
        objectId,
        revision: 4,
        contentType: "application/vnd.agent-native.content-vault-manifest+json",
        plaintext,
      }),
    ).resolves.toMatchObject({
      contentType: "application/vnd.agent-native.content-vault-manifest+json",
    });
    expect(request.mock.calls[2]?.[4]).toBe(
      "application/vnd.agent-native.content-vault-manifest+json",
    );
    expect(
      transferred.every((value) => value.every((byte) => byte === 0)),
    ).toBe(true);
    expect(plaintext).toEqual(Uint8Array.from(Buffer.from('{"title":"Moon"}')));

    await expect(
      client.sealContentObjectRevision({
        vaultId: vaultId.toUpperCase(),
        objectId,
        revision: 3,
        plaintext,
      }),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    await expect(
      client.openContentObjectRevision({
        vaultId,
        objectId,
        revision: Number.MAX_SAFE_INTEGER + 1,
        encodedRevision: ciphertext,
      }),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    expect(request).toHaveBeenCalledTimes(3);

    for (const mutation of [
      { objectId: "22".repeat(16) },
      { revision: 4 },
      { contentType: "text/plain" },
      { revisionId: Buffer.alloc(31) },
      { plaintextLength: plaintext.byteLength + 1 },
      { extra: true },
    ]) {
      const hostile = clientFor({
        version: 3,
        operation: "open_object",
        state: "opened",
        vaultId,
        objectId,
        contentType: "application/vnd.agent-native.content-document+json",
        revision: 3,
        epoch: 7,
        plaintextLength: plaintext.byteLength,
        revisionId,
        writerEndpointId,
        objectPayload: Buffer.from(plaintext),
        ...mutation,
      });
      await expect(
        hostile.openContentObjectRevision({
          vaultId,
          objectId,
          revision: 3,
          encodedRevision: ciphertext,
        }),
      ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    }
  });

  it("binds broker object custody to the exact native claimed job", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const jobId = "ffeeddccbbaa99887766554433221100";
    const jobHash = "ab".repeat(32);
    const objectId = "11223344556677889900aabbccddeeff";
    const plaintext = Uint8Array.from([1, 2, 3]);
    const ciphertext = Uint8Array.from([4, 5, 6]);
    const revisionId = Buffer.alloc(32, 7);
    const writerEndpointId = Buffer.alloc(16, 8);
    const request = vi.fn(async (operation: string, ...arguments_: unknown[]) =>
      operation === "seal_job_object"
        ? {
            version: 3,
            operation,
            state: "sealed",
            vaultId,
            objectId,
            contentType: arguments_[5],
            revision: arguments_[4],
            epoch: 7,
            plaintextLength: plaintext.byteLength,
            revisionId,
            objectPayload: Buffer.from(ciphertext),
          }
        : {
            version: 3,
            operation,
            state: "opened",
            vaultId,
            objectId,
            contentType: "application/vnd.agent-native.content-document+json",
            revision: arguments_[4],
            epoch: 7,
            plaintextLength: plaintext.byteLength,
            revisionId,
            writerEndpointId,
            objectPayload: Buffer.from(plaintext),
          },
    );
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));

    await expect(
      client.sealJobContentObjectRevision({
        vaultId,
        jobId,
        jobHash,
        objectId,
        revision: 2,
        plaintext,
      }),
    ).resolves.toMatchObject({ operation: "seal_job_object", revision: 2 });
    await expect(
      client.openJobContentObjectRevision({
        vaultId,
        jobId,
        jobHash,
        objectId,
        revision: 2,
        encodedRevision: ciphertext,
      }),
    ).resolves.toMatchObject({ operation: "open_job_object", revision: 2 });
    expect(request.mock.calls[0]?.slice(0, 7)).toEqual([
      "seal_job_object",
      vaultId,
      jobId,
      jobHash,
      objectId,
      2,
      "application/vnd.agent-native.content-document+json",
    ]);
    expect(request.mock.calls[1]?.slice(0, 6)).toEqual([
      "open_job_object",
      vaultId,
      jobId,
      jobHash,
      objectId,
      2,
    ]);
    await expect(
      client.openJobContentObjectRevision({
        vaultId,
        jobId,
        jobHash: jobHash.toUpperCase(),
        objectId,
        revision: 2,
        encodedRevision: ciphertext,
      }),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("issues requester grants only through the native vault boundary", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const recipientEndpointId = "11112222333344445555666677778888";
    const expiresAt = 1_721_114_711;
    const request = vi.fn(async () => ({
      version: 3,
      operation: "create_grant",
      state: "created",
      vaultId,
      recipientEndpointId,
      issuedAt: 1_721_111_111,
      expiresAt,
      grantId: Buffer.alloc(16, 5),
      grantRef: Buffer.alloc(32, 6),
      grantEnvelope: Buffer.from([0xa1, 1, 1]),
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(
      client.createContentGrant({ vaultId, recipientEndpointId, expiresAt }),
    ).resolves.toMatchObject({
      version: 1,
      suite: "anc/v1",
      operation: "create_grant",
      state: "created",
      vaultId,
      recipientEndpointId,
      expiresAt,
    });
    expect(request).toHaveBeenCalledWith(
      "create_grant",
      vaultId,
      recipientEndpointId,
      expiresAt,
    );
  });

  it("seals one semantically encoded job and binds the native reply", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const jobId = "ffeeddccbbaa99887766554433221100";
    const grantRef = "ab".repeat(32);
    const recipientEndpointId = "11112222333344445555666677778888";
    const expiresAt = 1_721_111_711;
    const jobPayload = Buffer.from([0xa1, 1, 1]);
    const request = vi.fn(async () => ({
      version: 3,
      operation: "seal_job",
      state: "sealed",
      vaultId,
      jobId,
      recipientEndpointId,
      epoch: 3,
      issuedAt: 1_721_111_111,
      expiresAt,
      algorithmId: "anc/v1",
      jobEnvelope: Buffer.from([0xa1, 2, 2]),
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(
      client.sealContentJob({
        vaultId,
        jobId,
        grantRef,
        recipientEndpointId,
        expiresAt,
        jobPayload,
      }),
    ).resolves.toMatchObject({
      operation: "seal_job",
      state: "sealed",
      vaultId,
      jobId,
      epoch: 3,
    });
    expect(request).toHaveBeenCalledWith(
      "seal_job",
      vaultId,
      jobId,
      grantRef,
      recipientEndpointId,
      expiresAt,
      expect.any(Buffer),
    );
    request.mockResolvedValueOnce({
      version: 3,
      operation: "seal_job",
      state: "sealed",
      vaultId,
      jobId: "00".repeat(16),
      recipientEndpointId,
      epoch: 3,
      issuedAt: 1_721_111_111,
      expiresAt,
      algorithmId: "anc/v1",
      jobEnvelope: Buffer.from([1]),
    });
    await expect(
      client.sealContentJob({
        vaultId,
        jobId,
        grantRef,
        recipientEndpointId,
        expiresAt,
        jobPayload,
      }),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
  });

  it("maps one encrypted broker job through the caller-independent authority boundary", async () => {
    const vaultId = "00112233445566778899aabbccddeeff";
    const endpointId = "11112222333344445555666677778888";
    const jobId = "ffeeddccbbaa99887766554433221100";
    const envelope = new Uint8Array([0xa1, 0x01, 0x01]);
    const request = vi.fn(async () => ({
      version: 3,
      operation: "open_job",
      jobHash: "ab".repeat(32),
      jobPayload: Buffer.from("scoped action"),
      resourceId: Buffer.alloc(16, 7),
      operationName: "get-document",
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(
      client.openHostedJob({
        version: 1,
        suite: "anc/v1",
        operation: "openHostedJob",
        vaultId,
        endpointId,
        jobId,
        jobEnvelope: envelope,
        epoch: 1,
        retryCount: 0,
        algorithmId: "anc-v1-job",
      }),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "openHostedJob",
      jobHash: "ab".repeat(32),
      jobPayload: Buffer.from("scoped action"),
      resourceId: Buffer.alloc(16, 7),
      operationName: "get-document",
    });
    expect(request).toHaveBeenCalledWith(
      "open_job",
      vaultId,
      jobId,
      expect.any(Buffer),
      1,
      0,
      "anc-v1-job",
    );
  });

  it("returns only the native requester-sealed result envelope", async () => {
    const request = vi.fn(async () => ({
      version: 3,
      operation: "seal_result",
      resultEnvelope: Buffer.from([0xa1, 0x01, 0x01]),
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(
      client.sealHostedResult({
        version: 1,
        suite: "anc/v1",
        operation: "sealHostedResult",
        vaultId: "00112233445566778899aabbccddeeff",
        endpointId: "11112222333344445555666677778888",
        jobId: "ffeeddccbbaa99887766554433221100",
        jobHash: "ab".repeat(32),
        state: "completed",
        resultPayload: Buffer.from("private result"),
      }),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "sealHostedResult",
      resultEnvelope: Buffer.from([0xa1, 0x01, 0x01]),
    });
    expect(request).toHaveBeenCalledWith(
      "seal_result",
      "00112233445566778899aabbccddeeff",
      "ffeeddccbbaa99887766554433221100",
      "ab".repeat(32),
      "completed",
      expect.any(Buffer),
    );
    await expect(
      client.sealHostedResult({
        version: 1,
        suite: "anc/v1",
        operation: "sealHostedResult",
        vaultId: "00112233445566778899aabbccddeeff",
        endpointId: "11112222333344445555666677778888",
        jobId: "ffeeddccbbaa99887766554433221100",
        jobHash: "ab".repeat(32),
        state: "completed",
        resultPayload: new Uint8Array(),
      }),
    ).resolves.toMatchObject({ operation: "sealHostedResult" });
  });

  it("signs only through the narrow native endpoint-proof operation", async () => {
    let transferred: Buffer | null = null;
    const request = vi.fn(async (_operation: string, proof: Buffer) => {
      transferred = proof;
      return {
        version: 3,
        operation: "sign_request",
        signature: Buffer.alloc(64, 9),
      };
    });
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    const proof = new Uint8Array([0xa1, 0x01, 0x01]);
    await expect(
      client.signEndpointRequest({
        version: 1,
        suite: "anc/v1",
        operation: "signEndpointRequest",
        unsignedProof: proof,
      }),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "signEndpointRequest",
      signature: Buffer.alloc(64, 9),
    });
    expect(request).toHaveBeenCalledWith("sign_request", expect.any(Buffer));
    expect(transferred).toEqual(Buffer.alloc(3));
    expect(proof).toEqual(new Uint8Array([0xa1, 0x01, 0x01]));
  });

  it("releases a sealed result only after an exact hosted receipt", async () => {
    const request = vi.fn(async () => ({
      version: 3,
      operation: "complete_result",
      state: "delivered",
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(
      client.acknowledgeHostedResult({
        version: 1,
        suite: "anc/v1",
        operation: "acknowledgeHostedResult",
        vaultId: "00112233445566778899aabbccddeeff",
        endpointId: "11112222333344445555666677778888",
        jobId: "ffeeddccbbaa99887766554433221100",
        jobHash: "ab".repeat(32),
        state: "completed",
      }),
    ).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "acknowledgeHostedResult",
      delivered: true,
    });
    expect(request).toHaveBeenCalledWith(
      "complete_result",
      "00112233445566778899aabbccddeeff",
      "ffeeddccbbaa99887766554433221100",
      "ab".repeat(32),
      "completed",
    );
  });

  it("recovers only an exact requester-encrypted pending result", async () => {
    const request = vi.fn(async () => ({
      version: 3,
      operation: "pending_result",
      state: "pending",
      jobId: "ffeeddccbbaa99887766554433221100",
      jobHash: "ab".repeat(32),
      resultState: "completed",
      epoch: 1,
      retryCount: 0,
      algorithmId: "anc-v1-job",
      resultEnvelope: Buffer.from([0xa1, 0x01, 0x01]),
    }));
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(
      client.recoverHostedResult({
        version: 1,
        suite: "anc/v1",
        operation: "recoverHostedResult",
        vaultId: "00112233445566778899aabbccddeeff",
        endpointId: "11112222333344445555666677778888",
      }),
    ).resolves.toMatchObject({
      operation: "recoverHostedResult",
      pending: {
        jobId: "ffeeddccbbaa99887766554433221100",
        state: "completed",
        epoch: 1,
        retryCount: 0,
      },
    });
    expect(request).toHaveBeenCalledWith(
      "pending_result",
      "00112233445566778899aabbccddeeff",
    );
  });

  it("copies and bounds bootstrap frames without claiming cryptographic acceptance", async () => {
    const vaultId = "10".repeat(16);
    const headHash = "20".repeat(32);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(async (..._arguments: Array<string | Buffer>) => {
      await gate;
      return {
        version: 3,
        operation: "accept_bootstrap",
        state: "parsed",
        vaultId,
        throughSequence: 3,
        headSequence: 5,
        headHash,
        complete: false,
      };
    });
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    const source = Uint8Array.from([1, 2, 3]);
    const pending = client.parseBootstrapFrame(source);
    source.fill(9);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(
      "accept_bootstrap",
      Buffer.from([1, 2, 3]),
    );
    const ownedFrame = request.mock.calls[0]![1] as Buffer;
    release();
    await expect(pending).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "accept_bootstrap",
      state: "parsed",
      vaultId,
      throughSequence: 3,
      headSequence: 5,
      headHash,
      complete: false,
    });
    expect(ownedFrame.every((byte) => byte === 0)).toBe(true);

    await expect(client.parseBootstrapFrame(new Uint8Array())).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    await expect(
      client.parseBootstrapFrame(new Uint8Array(26_746_885)),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    expect(request).toHaveBeenCalledTimes(1);

    for (const mutation of [
      { throughSequence: 6 },
      { throughSequence: Number.MAX_SAFE_INTEGER + 1 },
      { complete: true },
      { vaultId: "AB".repeat(16) },
      { extra: true },
    ]) {
      const hostile = clientFor({
        version: 3,
        operation: "accept_bootstrap",
        state: "parsed",
        vaultId,
        throughSequence: 3,
        headSequence: 5,
        headHash,
        complete: false,
        ...mutation,
      });
      await expect(
        hostile.parseBootstrapFrame(Uint8Array.of(1)),
      ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    }
  });

  it("streams recovery through native ceremony operations without exposing the phrase", async () => {
    const vaultId = "31".repeat(16);
    const headHash = "42".repeat(32);
    const observed: Array<{
      operation: string;
      bytes: number[];
      argumentCount: number;
      frame: Buffer;
    }> = [];
    const request = vi.fn(
      async (operation: string, ...arguments_: Array<string | Buffer>) => {
        if (operation === "recover_status") {
          return {
            version: 3,
            operation,
            state: "recovered",
            vaultId,
          };
        }
        const frame = arguments_[0] as Buffer;
        observed.push({
          operation,
          bytes: [...frame],
          argumentCount: arguments_.length,
          frame,
        });
        const complete = operation === "recover_page";
        return {
          version: 3,
          operation,
          state: complete ? "committing" : "accepted",
          vaultId,
          throughSequence: complete ? 5 : 2,
          headSequence: 5,
          headHash,
          complete,
        };
      },
    );
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    const first = Uint8Array.of(1, 2, 3);
    const firstPending = client.acceptPage(first);
    first.fill(9);
    await expect(firstPending).resolves.toEqual({
      vaultId,
      throughSequence: 2,
      head: { sequence: 5, hash: headHash },
      complete: false,
    });
    await expect(client.acceptPage(Uint8Array.of(4, 5))).resolves.toEqual({
      vaultId,
      throughSequence: 5,
      head: { sequence: 5, hash: headHash },
      complete: true,
    });
    expect(observed.map(({ operation }) => operation)).toEqual([
      "recover_begin",
      "recover_page",
    ]);
    expect(observed.map(({ bytes }) => bytes)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(observed.every(({ argumentCount }) => argumentCount === 1)).toBe(
      true,
    );
    expect(
      observed.every(({ frame }) => frame.every((byte) => byte === 0)),
    ).toBe(true);
    await expect(client.acceptPage(Uint8Array.of(6))).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(3, "recover_status", vaultId);
  });

  it("does not advance recovery after a failed or hostile first page", async () => {
    const vaultId = "51".repeat(16);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("native rejection"))
      .mockResolvedValueOnce({
        version: 3,
        operation: "recover_begin",
        state: "accepted",
        vaultId,
        throughSequence: 1,
        headSequence: 2,
        headHash: "62".repeat(32),
        complete: false,
      });
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    await expect(client.acceptPage(Uint8Array.of(1))).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    await expect(client.acceptPage(Uint8Array.of(2))).resolves.toMatchObject({
      vaultId,
      throughSequence: 1,
      complete: false,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "recover_begin",
      expect.any(Buffer),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "recover_begin",
      expect.any(Buffer),
    );

    for (const mutation of [
      { state: "verified" },
      { complete: true },
      { throughSequence: 3 },
      { operation: "recover_page" },
      { extra: true },
    ]) {
      const hostile = clientFor({
        version: 3,
        operation: "recover_begin",
        state: "accepted",
        vaultId,
        throughSequence: 1,
        headSequence: 2,
        headHash: "62".repeat(32),
        complete: false,
        ...mutation,
      });
      await expect(hostile.acceptPage(Uint8Array.of(1))).rejects.toEqual(
        new PrivateVaultNativeServiceClientError(),
      );
    }
  });

  it("copies and bounds the content-free genesis commit contract before queueing", async () => {
    const publicProof = {
      vaultId: "01".repeat(16),
      custodyGeneration: 2,
      activeEpoch: 1,
      sequence: 0,
      headHash: "02".repeat(32),
      membershipHash: "03".repeat(32),
      recoveryGeneration: 1,
      recoveryWrapHash: "04".repeat(32),
    } as const;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(async () => {
      await gate;
      return {
        version: 3,
        operation: "commit_genesis",
        state: "committed",
        ...publicProof,
      };
    });
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));
    const recoveryConfirmation = Uint8Array.from([1, 2]);
    const bootstrapTranscript = Uint8Array.from([3, 4]);
    const authorization = Uint8Array.from([5, 6]);
    const pending = client.commitGenesis({
      operation: "commit_genesis",
      recoveryConfirmation,
      bootstrapTranscript,
      authorization,
    });
    let secondInputRead = false;
    const secondInput = new Proxy({} as never, {
      ownKeys() {
        secondInputRead = true;
        throw new Error("must not inspect a second pending payload");
      },
    });
    await expect(client.commitGenesis(secondInput)).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    expect(secondInputRead).toBe(false);
    recoveryConfirmation.fill(9);
    bootstrapTranscript.fill(9);
    authorization.fill(9);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(
      "commit_genesis",
      Buffer.from([1, 2]),
      Buffer.from([3, 4]),
      Buffer.from([5, 6]),
    );
    const ownedBuffers = request.mock.calls[0]!.slice(1) as Buffer[];
    expect(ownedBuffers.map((field) => [...field])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    release();
    await expect(pending).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      operation: "commit_genesis",
      state: "committed",
      ...publicProof,
    });
    expect(
      ownedBuffers.every((field) => field.every((byte) => byte === 0)),
    ).toBe(true);

    const baseInput = {
      operation: "commit_genesis" as const,
      recoveryConfirmation: Uint8Array.of(1),
      bootstrapTranscript: Uint8Array.of(1),
      authorization: Uint8Array.of(1),
    };
    const invalidInputs: unknown[] = [null, { ...baseInput, extra: true }];
    for (const [field, maximum] of [
      ["recoveryConfirmation", 64 * 1024],
      ["bootstrapTranscript", 4 * 1024],
      ["authorization", 256 * 1024],
    ] as const) {
      invalidInputs.push(
        { ...baseInput, [field]: new Uint8Array() },
        { ...baseInput, [field]: new Uint8Array(maximum + 1) },
        { ...baseInput, [field]: "wrong type" },
      );
    }
    for (const input of invalidInputs) {
      await expect(client.commitGenesis(input as never)).rejects.toEqual(
        new PrivateVaultNativeServiceClientError(),
      );
    }
    expect(request).toHaveBeenCalledTimes(1);

    for (const mutation of [
      { custodyGeneration: 3 },
      { sequence: 1 },
      { membershipHash: "AB".repeat(32) },
      { recoveryGeneration: 2 },
      { extra: true },
    ]) {
      const hostileReply = clientFor({
        version: 3,
        operation: "commit_genesis",
        state: "committed",
        ...publicProof,
        ...mutation,
      });
      await expect(
        hostileReply.commitGenesis({
          operation: "commit_genesis",
          recoveryConfirmation: Uint8Array.of(1),
          bootstrapTranscript: Uint8Array.of(1),
          authorization: Uint8Array.of(1),
        }),
      ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    }

    const exactMaximumRequest = vi.fn(async () => ({
      version: 3,
      operation: "commit_genesis",
      state: "committed",
      ...publicProof,
    }));
    const exactMaximumClient = createPrivateVaultNativeServiceClientForTest(
      async () => ({ request: exactMaximumRequest }),
    );
    for (const [field, maximum] of [
      ["recoveryConfirmation", 64 * 1024],
      ["bootstrapTranscript", 4 * 1024],
      ["authorization", 256 * 1024],
    ] as const) {
      await expect(
        exactMaximumClient.commitGenesis({
          ...baseInput,
          [field]: new Uint8Array(maximum),
        }),
      ).resolves.toMatchObject({ state: "committed", ...publicProof });
    }
    expect(exactMaximumRequest).toHaveBeenCalledTimes(3);
  });

  it("exposes only public genesis and admission artifacts to the main process", async () => {
    const lookupId = "11".repeat(16);
    const vaultId = "22".repeat(16);
    const endpointId = "33".repeat(16);
    const candidate = Uint8Array.from([0xa1, 1, 2]);
    const observed: Array<{ operation: string; bytes: number[][] }> = [];
    const request = vi.fn(
      async (operation: string, ...arguments_: unknown[]) => {
        observed.push({
          operation,
          bytes: arguments_
            .filter((value): value is Buffer => Buffer.isBuffer(value))
            .map((value) => [...value]),
        });
        if (operation === "create_genesis") {
          return {
            version: 3,
            operation,
            state: "committed",
            lookupId,
            vaultId,
            candidate: Buffer.from(candidate),
          };
        }
        if (operation === "list_genesis") {
          return {
            version: 3,
            operation,
            state: "pending",
            candidates: [
              { lookupId, vaultId, candidate: Buffer.from(candidate) },
            ],
          };
        }
        if (operation === "authorize_admit" || operation === "accept_admit") {
          return {
            version: 3,
            operation,
            state: operation === "authorize_admit" ? "authorized" : "accepted",
            accountId: "account:test-user-0001",
            workspaceId: "workspace:test-content-0001",
            vaultId,
            endpointId,
            proofHeader: "proof_header_1",
            body: Buffer.from([0xa1, 3, 4]),
          };
        }
        return {
          version: 3,
          operation: "finalize_genesis",
          state: "cleaned",
          lookupId,
        };
      },
    );
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));

    await expect(client.beginTrustedGenesis()).resolves.toEqual({
      lookupId,
      candidate,
    });
    await expect(client.listPendingGenesis()).resolves.toEqual([
      { lookupId, candidate },
    ]);
    const challenge = Uint8Array.from([1, 2, 3]);
    await expect(
      client.authorizeAdmission({ lookupId, challenge }),
    ).resolves.toEqual({
      body: Uint8Array.from([0xa1, 3, 4]),
      proofHeader: "proof_header_1",
    });
    const receipt = Uint8Array.from([4, 5, 6]);
    await expect(
      client.acceptAdmissionReceipt({ lookupId, challenge, receipt }),
    ).resolves.toEqual({
      accountId: "account:test-user-0001",
      workspaceId: "workspace:test-content-0001",
      vaultId,
      body: Uint8Array.from([0xa1, 3, 4]),
      proofHeader: "proof_header_1",
    });
    await expect(
      client.finalizeHostedAppend({ lookupId, receipt }),
    ).resolves.toBeUndefined();

    expect(observed).toEqual([
      { operation: "create_genesis", bytes: [] },
      { operation: "list_genesis", bytes: [] },
      { operation: "authorize_admit", bytes: [[1, 2, 3]] },
      {
        operation: "accept_admit",
        bytes: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
      { operation: "finalize_genesis", bytes: [[4, 5, 6]] },
    ]);
    expect(JSON.stringify(observed)).not.toMatch(/recovery|mnemonic|entropy/);
  });

  it("rejects malformed public genesis replies and oversized ceremony inputs", async () => {
    const lookupId = "11".repeat(16);
    const malformed = clientFor({
      version: 3,
      operation: "create_genesis",
      state: "committed",
      lookupId,
      vaultId: "22".repeat(16),
      candidate: Buffer.from([1]),
      recoveryMnemonic: "forbidden",
    });
    await expect(malformed.beginTrustedGenesis()).rejects.toEqual(
      new PrivateVaultNativeServiceClientError(),
    );
    await expect(
      malformed.authorizeAdmission({
        lookupId,
        challenge: new Uint8Array(2049),
      }),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
    await expect(
      malformed.acceptAdmissionReceipt({
        lookupId,
        challenge: Uint8Array.of(1),
        receipt: new Uint8Array(2049),
      }),
    ).rejects.toEqual(new PrivateVaultNativeServiceClientError());
  });

  it("fails closed for unavailable, malformed, oversized, or unknown replies", async () => {
    const hostileValues = [
      null,
      { version: 3, operation: "health", state: "locked", available: false },
      {
        version: 3,
        operation: "health",
        state: "locked",
        available: true,
        vaultId: "forbidden",
      },
      {
        version: 3,
        operation: "health",
        state: "x".repeat(10_000),
        available: true,
      },
    ];
    for (const value of hostileValues) {
      await expect(clientFor(value).health()).resolves.toMatchObject({
        state: "unavailable",
        available: false,
        ready: false,
        unlocked: false,
      });
      await expect(clientFor(value).lock()).rejects.toEqual(
        new PrivateVaultNativeServiceClientError(),
      );
    }

    const unavailable = createPrivateVaultNativeServiceClientForTest(
      async () => {
        throw new Error("sensitive transport detail");
      },
    );
    await expect(unavailable.health()).resolves.toMatchObject({
      state: "unavailable",
    });
    await expect(unavailable.lock()).rejects.not.toThrow(
      /sensitive transport detail/,
    );
  });

  it("coalesces repeated calls and preserves lock order with a bounded queue", async () => {
    let releaseHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => {
      releaseHealth = resolve;
    });
    const request = vi.fn(
      async (operation: "health" | "lock" | "resume_rotation") => {
        if (operation === "health") {
          await healthGate;
          return {
            version: 3,
            operation: "health",
            state: "locked",
            available: true,
            rotationAckState: "retrying",
          };
        }
        return { version: 3, operation: "lock", state: "locked" };
      },
    );
    const client = createPrivateVaultNativeServiceClientForTest(async () => ({
      request,
    }));

    const healthCalls = Array.from({ length: 256 }, () => client.health());
    const lockCalls = Array.from({ length: 256 }, () => client.lock());
    expect(new Set(healthCalls).size).toBe(1);
    expect(new Set(lockCalls).size).toBe(1);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenNthCalledWith(1, "health");

    releaseHealth();
    await Promise.all(healthCalls);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenNthCalledWith(2, "lock");
    await Promise.all(lockCalls);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("offers no production dependency or path override", () => {
    expect(createPrivateVaultNativeServiceClient.length).toBe(0);
    expect(wrapperSource).toContain(
      'path.join(resourcesPath, "native", PACKAGED_ADDON_NAME)',
    );
    expect(wrapperSource).toContain("if (!app.isPackaged)");
    expect(wrapperSource).toContain('process.platform !== "darwin"');
    expect(wrapperSource).not.toContain("addonPath:");
    expect(wrapperSource).not.toContain("resourcesPath:");
    expect(wrapperSource).toContain(
      'process.env.VITEST !== "true" || process.versions.electron',
    );
    expect(wrapperSource).toContain(
      "composition must\n  // verify the universal addon and sign it",
    );
    expect(wrapperSource).toContain("before this require is reachable");
    expect(buildSource).not.toContain("codesign");
  });

  it("binds the connection to the signed service before resume", () => {
    expect(nativeSource).toContain(
      '"com.agentnative.desktop.private-vault-service"',
    );
    expect(nativeSource).toContain('"W3PMF2T3MW"');
    expect(nativeSource).toContain("anchor apple generic");
    expect(nativeSource).toContain(
      "xpc_connection_set_peer_code_signing_requirement",
    );
    expect(nativeSource.indexOf("requirementStatus")).toBeLessThan(
      nativeSource.indexOf("xpc_connection_resume(connection)"),
    );
    expect(serviceIdentity).toContain(
      'PV_CLIENT_IDENTIFIER "com.agentnative.desktop"',
    );
    expect(serviceIdentity).toContain('PV_TEAM_IDENTIFIER "W3PMF2T3MW"');
    expect(serviceSource).toContain(
      "xpc_connection_set_peer_code_signing_requirement",
    );
    expect(serviceSource).toContain("SecCodeCreateWithXPCMessage");
    expect(serviceSource).toContain("SecCodeCheckValidity");
    expect(serviceSource).toContain("AncPrivateVaultResumePendingGenesisState");
    expect(serviceSource).toContain("AncPrivateVaultTrustedTimeStore");
    expect(serviceSource).toContain(
      "AncPrivateVaultGenesisPersistedTrustedClock",
    );
    expect(serviceSource).toContain("AncPrivateVaultGenesisPreparationStore");
    expect(serviceSource).toContain(
      "PVRequestCanRun(&request, gStartupComplete)",
    );
    expect(
      serviceSource.indexOf("AncPrivateVaultResumePendingGenesisState"),
    ).toBeLessThan(serviceSource.indexOf("gStartupComplete = true"));
    expect(serviceSource.indexOf("gStartupComplete = true")).toBeLessThan(
      serviceSource.indexOf("xpc_main(PVConnectionHandler)"),
    );
    expect(nativeSource).not.toContain("listVaultIds");
    expect(wrapperSource).not.toContain("resume_pending_genesis");
    expect(nativeSource).toContain("PVTrustedGenesisCollectFullPhrase");
    expect(nativeSource).toContain("PVTrustedGenesisConfirmAdmission");
    expect(nativeSource).toContain("PVTrustedRecoveryCollectPhrase");
    expect(nativeSource).not.toMatch(
      /PVSet(Buffer|String)[^\n]*recoveryMnemonic/,
    );
    expect(wrapperSource).not.toContain("recoveryMnemonic");
    expect(buildSource).toContain("-framework AppKit");
  });

  it("keeps Electron as the XPC peer and never trusts caller metadata", () => {
    expect(nativeSource).toContain("napi_create_async_work");
    expect(nativeSource).toContain("napi_queue_async_work");
    expect(nativeSource).toContain("if (!gRequestGate.tryAcquire())");
    expect(nativeSource.indexOf("gRequestGate.tryAcquire()")).toBeLessThan(
      nativeSource.indexOf("napi_queue_async_work"),
    );
    expect(nativeSource.indexOf("gRequestGate.tryAcquire()")).toBeLessThan(
      nativeSource.indexOf("outputs[index]->assign"),
    );
    expect(wrapperSource.indexOf("if (this.#genesisPending)")).toBeLessThan(
      wrapperSource.indexOf("fields = copyCommitGenesisInput(input)"),
    );
    expect(wrapperSource).toContain(
      "for (const field of fields) field.fill(0)",
    );
    expect(nativeSource).toContain("dispatch_semaphore_wait");
    expect(nativeSource).toContain("PV_REQUEST_TIMEOUT_NANOSECONDS");
    expect(nativeSource).toContain("xpc_connection_cancel(connection)");
    expect(nativeSource).toContain("xpc_release(connection)");
    expect(nativeSource).toContain("dispatch_release(queue)");
    expect(nativeSource).toContain("dispatch_release(semaphore_)");
    expect(nativeSource).not.toContain("send_message_with_reply_sync");
    expect(nativeSource).not.toMatch(/child_process|spawn|exec|stdout|stderr/);
    expect(nativeSource).not.toMatch(
      /caller(Id|Identity)|executablePath|\bpid\b/i,
    );
  });

  it("rejects concurrent native work immediately while one slot is held", () => {
    expect(
      execFileSync(join(nativeRoot, "run-request-gate-tests.sh"), {
        encoding: "utf8",
      }),
    ).toContain("request gate tests passed");
  });

  it("builds and loads one N-API addon with both macOS architectures", async () => {
    const outputRoot = join(nativeRoot, "build-test");
    const addonPath = execFileSync(
      join(desktopRoot, "native", "build-private-vault-xpc-client.sh"),
      [outputRoot],
      { encoding: "utf8" },
    ).trim();
    expect(statSync(addonPath).isFile()).toBe(true);
    const architectures = execFileSync("lipo", ["-archs", addonPath], {
      encoding: "utf8",
    });
    expect(architectures).toContain("arm64");
    expect(architectures).toContain("x86_64");

    const require = createRequire(import.meta.url);
    const addon = require(addonPath) as {
      request(
        operation: string,
        ...arguments_: Array<string | Buffer>
      ): Promise<unknown>;
    };
    expect(Object.keys(addon)).toEqual(["request"]);
    await expect(addon.request("health")).rejects.toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("unknown")).toThrow(
      "Private Vault native service request failed",
    );
    expect(() =>
      addon.request(
        "inspect_enroll",
        "00112233445566778899aabbccddeeff",
        Buffer.from([1]),
      ),
    ).toThrow("Private Vault native service request failed");
    expect(() =>
      addon.request(
        "decide_enroll",
        "ffeeddccbbaa00998877665544332211",
        "confirmed",
      ),
    ).toThrow("Private Vault native service request failed");
    expect(() => addon.request("x".repeat(17))).toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("resume_rotation")).toThrow(
      "Private Vault native service request failed",
    );
    expect(() =>
      addon.request("resume_rotation", "00112233445566778899AABBCCDDEEFF"),
    ).toThrow("Private Vault native service request failed");
    await expect(
      addon.request("resume_rotation", "00112233445566778899aabbccddeeff"),
    ).rejects.toThrow("Private Vault native service request failed");
    expect(() => addon.request("commit_genesis")).toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("recover_begin")).toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("recover_begin", Buffer.alloc(0))).toThrow(
      "Private Vault native service request failed",
    );
    expect(() => addon.request("recover_page", Buffer.alloc(0))).toThrow(
      "Private Vault native service request failed",
    );
    expect(() =>
      addon.request(
        "commit_genesis",
        Buffer.alloc(1),
        Buffer.alloc(4 * 1024 + 1),
        Buffer.alloc(1),
      ),
    ).toThrow("Private Vault native service request failed");
    await expect(
      addon.request(
        "commit_genesis",
        Buffer.alloc(1),
        Buffer.alloc(1),
        Buffer.alloc(1),
      ),
    ).rejects.toThrow("Private Vault native service request failed");
    const genesisMaximums = [64 * 1024, 4 * 1024, 256 * 1024] as const;
    for (let index = 0; index < genesisMaximums.length; index += 1) {
      const exact = genesisMaximums.map((maximum, fieldIndex) =>
        Buffer.alloc(fieldIndex === index ? maximum : 1),
      );
      await expect(addon.request("commit_genesis", ...exact)).rejects.toThrow(
        "Private Vault native service request failed",
      );
      for (const invalid of [
        Buffer.alloc(0),
        Buffer.alloc(genesisMaximums[index]! + 1),
        "wrong type",
      ]) {
        const fields: Array<string | Buffer> = [
          Buffer.alloc(1),
          Buffer.alloc(1),
          Buffer.alloc(1),
        ];
        fields[index] = invalid;
        expect(() => addon.request("commit_genesis", ...fields)).toThrow(
          "Private Vault native service request failed",
        );
      }
    }
  }, 30_000);
});
