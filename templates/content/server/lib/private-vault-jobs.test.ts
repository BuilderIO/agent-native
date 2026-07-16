import { describe, expect, it, vi } from "vitest";

import {
  buildPrivateVaultJobRetentionItem,
  createPrivateVaultJobService,
  PrivateVaultJobConflictError,
  PrivateVaultJobNotFoundError,
  type PrivateVaultEndpointPrincipal,
  type PrivateVaultJobBlobStore,
  type PrivateVaultJobMetadata,
  type PrivateVaultJobResultMetadata,
  type PrivateVaultJobScope,
  type PrivateVaultJobStagingService,
  type PrivateVaultJobStore,
} from "./private-vault-jobs.js";

const scope = {
  ownerEmail: "owner@example.com",
  orgId: "org:test",
  vaultId: "vault:test",
};
const principal: PrivateVaultEndpointPrincipal = {
  ...scope,
  endpointId: "endpoint:test",
};
const input = {
  vaultId: scope.vaultId,
  jobId: "job:test",
  grantId: "grant:test",
  recipientEndpointId: principal.endpointId,
  epoch: 1,
  algorithmId: "anc-v1",
  ciphertextByteLength: 4,
  issuedAt: "2026-07-16T12:00:00.000Z",
  expiresAt: "2026-07-16T13:00:00.000Z",
};

function sameScope(a: PrivateVaultJobScope, b: PrivateVaultJobScope) {
  return (
    a.ownerEmail === b.ownerEmail &&
    a.orgId === b.orgId &&
    a.vaultId === b.vaultId
  );
}

function harness() {
  let clock = "2026-07-16T12:05:00.000Z";
  let endpointActive = true;
  let job: PrivateVaultJobMetadata | null = null;
  let result: PrivateVaultJobResultMetadata | null = null;
  const bytes = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const stages = new Map<string, unknown>();
  const key = (coordinate: { part: string }) => coordinate.part;
  const store = {
    isActiveEndpoint: vi.fn(
      async (candidate) =>
        endpointActive &&
        sameScope(candidate, scope) &&
        candidate.endpointId === principal.endpointId,
    ),
    authorizeEnqueue: vi.fn(async (candidate) => sameScope(candidate, scope)),
    get: vi.fn(async (candidate, jobId) =>
      sameScope(candidate, scope) && job?.jobId === jobId
        ? ({ ...job } as PrivateVaultJobMetadata)
        : null,
    ),
    persist: vi.fn(async (candidate, next, stage) => {
      calls.push("metadata:request");
      if (!sameScope(candidate, scope))
        throw new PrivateVaultJobNotFoundError();
      if (job) throw new PrivateVaultJobConflictError();
      if (!stages.has(stage.stageId)) throw new PrivateVaultJobConflictError();
      job = { ...next };
      stages.delete(stage.stageId);
      return { ...job } as PrivateVaultJobMetadata;
    }),
    list: vi.fn(async (candidate) =>
      sameScope(candidate, scope) && job
        ? [{ ...job } as PrivateVaultJobMetadata]
        : [],
    ),
    cancel: vi.fn(async (candidate, jobId) => {
      if (
        !sameScope(candidate, scope) ||
        job?.jobId !== jobId ||
        ["cancelled", "completed", "failed"].includes(
          (job as PrivateVaultJobMetadata).state,
        )
      )
        return null;
      job = {
        ...(job as PrivateVaultJobMetadata),
        state: "cancelled",
        leaseExpiresAt: null,
        retryAt: null,
      };
      return { ...job } as PrivateVaultJobMetadata;
    }),
    claim: vi.fn(async (candidate, _now, leaseExpiresAt) => {
      if (!endpointActive) return null;
      if (
        job?.state === "leased" &&
        Date.parse(job.leaseExpiresAt ?? "") <= Date.parse(_now)
      ) {
        job = {
          ...job,
          state: "queued",
          retryCount: job.retryCount + 1,
          leaseExpiresAt: null,
        };
      }
      if (
        !sameScope(candidate, scope) ||
        candidate.endpointId !== principal.endpointId ||
        job?.state !== "queued"
      )
        return null;
      job = {
        ...(job as PrivateVaultJobMetadata),
        state: "leased",
        leaseExpiresAt,
      };
      return { ...job } as PrivateVaultJobMetadata;
    }),
    acknowledge: vi.fn(async (candidate, jobId, retryCount, now) => {
      if (
        !sameScope(candidate, scope) ||
        candidate.endpointId !== principal.endpointId ||
        job?.jobId !== jobId ||
        (job as PrivateVaultJobMetadata).state !== "leased" ||
        (job as PrivateVaultJobMetadata).retryCount !== retryCount ||
        Date.parse((job as PrivateVaultJobMetadata).leaseExpiresAt ?? "") <=
          Date.parse(now)
      )
        return null;
      job = {
        ...(job as PrivateVaultJobMetadata),
        state: "acknowledged",
        leaseExpiresAt: null,
      };
      return { ...job } as PrivateVaultJobMetadata;
    }),
    retry: vi.fn(async (candidate, jobId, retryCount, retryAt, now) => {
      if (
        !sameScope(candidate, scope) ||
        candidate.endpointId !== principal.endpointId ||
        job?.jobId !== jobId ||
        !["leased", "acknowledged"].includes(
          (job as PrivateVaultJobMetadata).state,
        ) ||
        (job as PrivateVaultJobMetadata).retryCount !== retryCount ||
        ((job as PrivateVaultJobMetadata).state === "leased" &&
          Date.parse((job as PrivateVaultJobMetadata).leaseExpiresAt ?? "") <=
            Date.parse(now)) ||
        Date.parse(retryAt) <= Date.parse(now) ||
        Date.parse(retryAt) >=
          Date.parse((job as PrivateVaultJobMetadata).expiresAt)
      )
        return null;
      job = {
        ...(job as PrivateVaultJobMetadata),
        state: "retry_wait",
        retryCount: retryCount + 1,
        retryAt,
        leaseExpiresAt: null,
      };
      return { ...job } as PrivateVaultJobMetadata;
    }),
    requeue: vi.fn(async (candidate, jobId, retryCount, now) => {
      if (
        !sameScope(candidate, scope) ||
        candidate.endpointId !== principal.endpointId ||
        job?.jobId !== jobId ||
        (job as PrivateVaultJobMetadata).state !== "retry_wait" ||
        (job as PrivateVaultJobMetadata).retryCount !== retryCount ||
        Date.parse((job as PrivateVaultJobMetadata).retryAt ?? "") >
          Date.parse(now) ||
        Date.parse((job as PrivateVaultJobMetadata).expiresAt) <=
          Date.parse(now)
      )
        return null;
      job = {
        ...(job as PrivateVaultJobMetadata),
        state: "queued",
        retryAt: null,
      };
      return { ...job } as PrivateVaultJobMetadata;
    }),
    complete: vi.fn(async (candidate, next, now, stage) => {
      calls.push("metadata:result");
      if (
        !sameScope(candidate, scope) ||
        candidate.endpointId !== principal.endpointId ||
        job?.jobId !== next.jobId ||
        (job as PrivateVaultJobMetadata).state !== "acknowledged" ||
        (job as PrivateVaultJobMetadata).retryCount !== next.retryCount ||
        (job as PrivateVaultJobMetadata).epoch !== next.epoch ||
        (job as PrivateVaultJobMetadata).algorithmId !== next.algorithmId ||
        Date.parse((job as PrivateVaultJobMetadata).expiresAt) <=
          Date.parse(now) ||
        result
      )
        return null;
      if (!stages.has(stage.stageId)) throw new PrivateVaultJobConflictError();
      result = { ...next };
      job = { ...(job as PrivateVaultJobMetadata), state: next.state };
      stages.delete(stage.stageId);
      return { ...job } as PrivateVaultJobMetadata;
    }),
    getResult: vi.fn(async (candidate, jobId) =>
      sameScope(candidate, scope) && result?.jobId === jobId
        ? ({ ...result } as PrivateVaultJobResultMetadata)
        : null,
    ),
  } as unknown as PrivateVaultJobStore;
  const blobs = {
    put: vi.fn(async ({ coordinate, ciphertext, expectedByteLength }) => {
      calls.push(`blob:${coordinate.part}`);
      expect(ciphertext.byteLength).toBe(expectedByteLength);
      const existing = bytes.get(key(coordinate));
      if (existing && Buffer.compare(existing, ciphertext) !== 0)
        throw new Error("collision");
      bytes.set(key(coordinate), new Uint8Array(ciphertext));
      return {
        locator: {
          kind: "agent-native.protected-ciphertext",
          version: 1,
          provider: "test",
          opaque: true,
          coordinate,
        },
        byteLength: ciphertext.byteLength,
        created: !existing,
      };
    }),
    read: vi.fn(async (coordinate) => {
      const ciphertext = bytes.get(key(coordinate));
      if (!ciphertext) throw new Error("missing");
      return { ciphertext, byteLength: ciphertext.byteLength };
    }),
    delete: vi.fn(async (coordinate) => ({
      deleted: bytes.delete(key(coordinate)),
    })),
  } as unknown as PrivateVaultJobBlobStore;
  const staging = {
    stage: vi.fn(async (candidateScope, coordinate) => {
      calls.push(`stage:${coordinate.part}`);
      const stage = {
        stageId: `${coordinate.jobId}:${coordinate.part}`,
        ...candidateScope,
        coordinate,
        stagedAt: clock,
        expiresAt: "2026-07-17T12:05:00.000Z",
      };
      stages.set(stage.stageId, stage);
      return stage;
    }),
    clearAfterMetadataCommit: vi.fn(async (stage) => {
      calls.push(`clear:${stage.coordinate.part}`);
      stages.delete(stage.stageId);
    }),
  } as unknown as PrivateVaultJobStagingService;
  const service = createPrivateVaultJobService({
    store,
    blobs,
    staging,
    now: () => clock,
    emitSync: vi.fn(),
  });
  return {
    service,
    store,
    blobs,
    bytes,
    calls,
    stages,
    staging,
    getJob: () => job,
    setNow: (value: string) => {
      clock = value;
    },
    revokeEndpoint: () => {
      endpointActive = false;
    },
  };
}

describe("Private Vault opaque job relay", () => {
  it("builds a deterministic job-retention ledger row from the exact transition time", () => {
    const retentionScope = {
      ...scope,
      vaultId: "vault_opaque_0001",
    };
    const retentionJobId = "job_opaque_000001";
    const item = buildPrivateVaultJobRetentionItem(
      retentionScope,
      retentionJobId,
      "2026-07-16T12:05:00.000Z",
    );
    expect(item).toMatchObject({
      ownerEmail: retentionScope.ownerEmail,
      orgId: retentionScope.orgId,
      vaultId: retentionScope.vaultId,
      resourceKind: "job",
      resourceId: retentionJobId,
      epoch: null,
      triggerAt: "2026-07-16T12:05:00.000Z",
      phase: "pending",
    });
    expect(
      buildPrivateVaultJobRetentionItem(
        retentionScope,
        retentionJobId,
        "2026-07-16T12:05:00.000Z",
      ).id,
    ).toBe(item.id);
  });

  it("stores ciphertext in the protected store and only routing metadata in the job store", async () => {
    const { service, store, bytes, calls, stages } = harness();
    const ciphertext = Uint8Array.from([1, 2, 3, 4]);
    await service.enqueue(scope, { ...input, ciphertext });
    expect(bytes.get("request")).toEqual(ciphertext);
    expect(store.persist).toHaveBeenCalledWith(
      scope,
      expect.not.objectContaining({ ciphertext: expect.anything() }),
      expect.objectContaining({ stageId: `${input.jobId}:request` }),
    );
    expect(calls.slice(0, 3)).toEqual([
      "stage:request",
      "blob:request",
      "metadata:request",
    ]);
    expect(stages.size).toBe(0);
  });

  it("verifies immutable bytes without reopening staging on a lost-response retry", async () => {
    const { service, store, blobs, staging } = harness();
    const ciphertext = Uint8Array.from([1, 2, 3, 4]);

    await service.enqueue(scope, { ...input, ciphertext });
    await expect(
      service.enqueue(scope, { ...input, ciphertext }),
    ).resolves.toMatchObject({ jobId: input.jobId, state: "queued" });

    expect(store.persist).toHaveBeenCalledOnce();
    expect(staging.stage).toHaveBeenCalledOnce();
    expect(blobs.put).toHaveBeenCalledTimes(2);
    await expect(
      service.enqueue(scope, {
        ...input,
        ciphertext: Uint8Array.from([9, 9, 9, 9]),
      }),
    ).rejects.toThrow("collision");
    expect(staging.stage).toHaveBeenCalledOnce();
  });

  it("fails cross-tenant authorization before writing ciphertext", async () => {
    const { service, blobs } = harness();
    await expect(
      service.enqueue(
        { ...scope, ownerEmail: "intruder@example.com" },
        { ...input, ciphertext: Uint8Array.from([1, 2, 3, 4]) },
      ),
    ).rejects.toBeInstanceOf(PrivateVaultJobNotFoundError);
    expect(blobs.put).not.toHaveBeenCalled();
  });

  it("compensates a protected write when SQL persistence fails", async () => {
    const { service, store, blobs, bytes, staging, stages } = harness();
    vi.mocked(store.persist).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(
      service.enqueue(scope, {
        ...input,
        ciphertext: Uint8Array.from([1, 2, 3, 4]),
      }),
    ).rejects.toThrow("database unavailable");
    expect(blobs.delete).toHaveBeenCalled();
    expect(bytes.has("request")).toBe(false);
    expect(staging.clearAfterMetadataCommit).not.toHaveBeenCalled();
    expect(stages.size).toBe(1);
  });

  it("leaves the durable request stage intact when Blob storage fails", async () => {
    const { service, blobs, staging, stages, calls } = harness();
    vi.mocked(blobs.put).mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    await expect(
      service.enqueue(scope, {
        ...input,
        ciphertext: Uint8Array.from([1, 2, 3, 4]),
      }),
    ).rejects.toThrow("provider unavailable");
    expect(calls).toEqual(["stage:request"]);
    expect(staging.clearAfterMetadataCommit).not.toHaveBeenCalled();
    expect(stages.size).toBe(1);
  });

  it("does not depend on a post-commit staging clear", async () => {
    const { service, staging, stages } = harness();
    vi.mocked(staging.clearAfterMetadataCommit).mockRejectedValueOnce(
      new Error("simulated process death before stage clear"),
    );
    await expect(
      service.enqueue(scope, {
        ...input,
        ciphertext: Uint8Array.from([1, 2, 3, 4]),
      }),
    ).resolves.toMatchObject({ state: "queued" });
    expect(staging.clearAfterMetadataCommit).not.toHaveBeenCalled();
    expect(stages.size).toBe(0);
  });

  it("fences stale attempts through claim, acknowledge, retry, and requeue", async () => {
    const { service, getJob, setNow } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    await expect(
      service.acknowledge(principal, input.jobId, 1),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    await service.acknowledge(principal, input.jobId, 0);
    await service.retry(principal, input.jobId, 0, "2026-07-16T12:06:00.000Z");
    expect(getJob()?.retryCount).toBe(1);
    await expect(
      service.requeue(principal, input.jobId, 0),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    setNow("2026-07-16T12:06:00.000Z");
    await service.requeue(principal, input.jobId, 1);
    expect(getJob()?.state).toBe("queued");
  });

  it("preserves the opaque jobHash for PR5 client verification while fencing the result slot", async () => {
    const { service, blobs, setNow, calls, stages } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    await service.acknowledge(principal, input.jobId, 0);
    await service.retry(principal, input.jobId, 0, "2026-07-16T12:05:30.000Z");
    setNow("2026-07-16T12:05:30.000Z");
    await service.requeue(principal, input.jobId, 1);
    await service.claim(principal);
    await service.acknowledge(principal, input.jobId, 1);
    const result = {
      vaultId: scope.vaultId,
      jobId: input.jobId,
      epoch: 1,
      jobHash: "digest:job",
      algorithmId: "anc-v1",
      ciphertextByteLength: 3,
      state: "completed" as const,
      retryCount: 1,
      ciphertext: Uint8Array.from([5, 6, 7]),
    };
    await service.submitResult(principal, result);
    expect(calls.slice(-3)).toEqual([
      "stage:result",
      "blob:result",
      "metadata:result",
    ]);
    expect(stages.size).toBe(0);
    const owner = await service.getResult(scope, input.jobId);
    expect(owner.ciphertext).toEqual(result.ciphertext);
    expect(owner.result.jobHash).toBe("digest:job");
    await expect(
      service.submitResult(principal, result),
    ).resolves.toMatchObject({
      jobHash: "digest:job",
      state: "completed",
    });
    expect(blobs.delete).not.toHaveBeenCalled();
    await expect(
      service.submitResult(principal, {
        ...result,
        ciphertext: Uint8Array.from([8, 9, 10]),
      }),
    ).rejects.toThrow("collision");
  });

  it("does not accept a different endpoint as the recipient principal", async () => {
    const { service } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    expect(
      await service.claim({ ...principal, endpointId: "endpoint:other" }),
    ).toBeNull();
  });

  it("rejects acknowledgement after the lease expires", async () => {
    const { service, setNow } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    setNow("2026-07-16T12:06:01.000Z");
    await expect(
      service.acknowledge(principal, input.jobId, 0),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
  });

  it("increments the attempt fence before leasing expired work again", async () => {
    const { service, setNow, getJob } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    setNow("2026-07-16T12:06:01.000Z");
    await service.claim(principal);
    expect(getJob()?.retryCount).toBe(1);
    await expect(
      service.acknowledge(principal, input.jobId, 0),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    await expect(
      service.acknowledge(principal, input.jobId, 1),
    ).resolves.toMatchObject({ state: "acknowledged", retryCount: 1 });
  });

  it("rejects a result whose algorithm does not match its job", async () => {
    const { service, blobs, staging, stages } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    await service.acknowledge(principal, input.jobId, 0);
    await expect(
      service.submitResult(principal, {
        vaultId: scope.vaultId,
        jobId: input.jobId,
        epoch: 1,
        jobHash: "digest:job",
        algorithmId: "other-suite",
        ciphertextByteLength: 1,
        state: "completed",
        retryCount: 0,
        ciphertext: Uint8Array.from([5]),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    expect(blobs.delete).toHaveBeenCalledTimes(1);
    expect(staging.clearAfterMetadataCommit).not.toHaveBeenCalled();
    expect(stages.size).toBe(1);
  });

  it("rejects retry scheduling outside the live job window", async () => {
    const { service } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    await expect(
      service.retry(principal, input.jobId, 0, "2026-07-16T12:05:00.000Z"),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    await expect(
      service.retry(principal, input.jobId, 0, input.expiresAt),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
  });

  it("fails every endpoint operation after revocation between steps", async () => {
    const { service, blobs, revokeEndpoint } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    revokeEndpoint();
    await expect(
      service.getRequest(principal, input.jobId),
    ).rejects.toBeInstanceOf(PrivateVaultJobNotFoundError);
    await expect(
      service.acknowledge(principal, input.jobId, 0),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    await expect(service.claim(principal)).resolves.toBeNull();
    expect(blobs.read).not.toHaveBeenCalled();
  });

  it("rejects provider byte counts that disagree with SQL metadata", async () => {
    const { service, blobs } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    vi.mocked(blobs.read).mockResolvedValueOnce({
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
      byteLength: 3,
    });
    await expect(
      service.getRequest(principal, input.jobId),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
  });

  it("allows an exact retry to finish metadata after a request Blob write", async () => {
    const { service, bytes, store } = harness();
    bytes.set("request", Uint8Array.from([1, 2, 3, 4]));
    await expect(
      service.enqueue(scope, {
        ...input,
        ciphertext: Uint8Array.from([1, 2, 3, 4]),
      }),
    ).resolves.toMatchObject({ jobId: input.jobId, state: "queued" });
    expect(store.persist).toHaveBeenCalledOnce();
    expect(bytes.get("request")).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it("allows an exact result retry while still verifying provider byte count", async () => {
    const { service, bytes, blobs } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    await service.acknowledge(principal, input.jobId, 0);
    bytes.set("result", Uint8Array.from([5, 6, 7]));
    await service.submitResult(principal, {
      vaultId: scope.vaultId,
      jobId: input.jobId,
      epoch: 1,
      jobHash: "digest:job",
      algorithmId: "anc-v1",
      ciphertextByteLength: 3,
      state: "completed",
      retryCount: 0,
      ciphertext: Uint8Array.from([5, 6, 7]),
    });
    vi.mocked(blobs.read).mockResolvedValueOnce({
      ciphertext: Uint8Array.from([5, 6, 7]),
      byteLength: 2,
    });
    await expect(service.getResult(scope, input.jobId)).rejects.toBeInstanceOf(
      PrivateVaultJobConflictError,
    );
  });

  it("rejects result submission when the endpoint is revoked after acknowledgement", async () => {
    const { service, blobs, revokeEndpoint } = harness();
    await service.enqueue(scope, {
      ...input,
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
    });
    await service.claim(principal);
    await service.acknowledge(principal, input.jobId, 0);
    revokeEndpoint();
    await expect(
      service.submitResult(principal, {
        vaultId: scope.vaultId,
        jobId: input.jobId,
        epoch: 1,
        jobHash: "digest:job",
        algorithmId: "anc-v1",
        ciphertextByteLength: 1,
        state: "completed",
        retryCount: 0,
        ciphertext: Uint8Array.from([5]),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultJobConflictError);
    expect(blobs.put).toHaveBeenCalledTimes(1);
  });
});
