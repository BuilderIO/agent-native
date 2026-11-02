import {
  BUILDER_ASSETS_WRITE_SCOPE,
  resolveBuilderRequestAuthorization,
  runWithRequestContext,
} from "@agent-native/core/server";

import type { CleanupPayload } from "./recording-media-lifecycle.js";
import { s3MediaCleanupFingerprint } from "./s3-upload-provider.js";

export interface MediaCleanupScope {
  credentialRef?: string | null;
  storageFingerprint?: string | null;
}

function builderCredentialRef(
  authorization: NonNullable<
    Awaited<ReturnType<typeof resolveBuilderRequestAuthorization>>
  >,
): string {
  return authorization.source === "oauth"
    ? `oauth:${authorization.oauthScope ?? ""}:${authorization.oauthConnectionId ?? ""}`
    : `legacy:${authorization.legacyCredentialKey ?? "BUILDER_PRIVATE_KEY"}:${authorization.legacyPublicKey ?? ""}`;
}

export async function captureMediaCleanupScope(input: {
  ownerEmail: string;
  orgId: string | null;
  storageMode: "own" | "hosted" | null;
  urls: string[];
}): Promise<MediaCleanupScope> {
  return runWithRequestContext(
    {
      userEmail: input.ownerEmail,
      ...(input.orgId ? { orgId: input.orgId } : {}),
    },
    async () => {
      const scope: MediaCleanupScope = {};
      if (input.urls.some((url) => builderObjectKey(url))) {
        try {
          const auth = await resolveBuilderRequestAuthorization({
            requiredScope: BUILDER_ASSETS_WRITE_SCOPE,
          });
          scope.credentialRef = auth ? builderCredentialRef(auth) : null;
        } catch {
          scope.credentialRef = null;
        }
      }
      for (const url of input.urls) {
        if (builderObjectKey(url)) continue;
        try {
          scope.storageFingerprint = await s3MediaCleanupFingerprint(
            url,
            input.storageMode === "hosted" ? "hosted" : "own",
          );
        } catch {
          scope.storageFingerprint = null;
        }
        if (scope.storageFingerprint) break;
      }
      return scope;
    },
  );
}

export interface MediaCleanupStep {
  phase: string;
  reason?: string | null;
  httpStatus?: number;
  servingStatus?: number;
  payload?: CleanupPayload;
}

function withoutRegisteredUrl(payload: CleanupPayload): CleanupPayload {
  const retry = { ...payload };
  delete retry.registeredUrl;
  return retry;
}

export function builderObjectKey(raw: string): string | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "cdn.builder.io" ||
    url.username ||
    url.password
  )
    return null;
  const path = url.pathname.replace(/%2[fF]/g, "/");
  const match = path.match(
    /\/assets\/([A-Za-z0-9_-]{8,128})\/([a-f0-9]{32})(?:\/compressed|-original)?$/,
  );
  return match ? `builder:${match[1]}:${match[2]}` : null;
}

export async function deleteBuilderMediaForCleanup(
  object: {
    recordingId: string;
    ownerEmail: string;
    objectKey: string;
    phase: string;
    payload: CleanupPayload;
  },
  checkpoint?: (step: MediaCleanupStep) => Promise<void>,
): Promise<MediaCleanupStep> {
  const [provider, space, assetId] = object.objectKey.split(":");
  if (
    provider !== "builder" ||
    !space ||
    !assetId ||
    !object.payload.urls.length ||
    object.payload.urls.some(
      (url) => builderObjectKey(url) !== object.objectKey,
    )
  )
    return { phase: "blocked", reason: "object_identity_mismatch" };
  const proof = object.payload.builderUpload;
  if (
    !proof ||
    proof.recordingId !== object.recordingId ||
    proof.ownerEmail !== object.ownerEmail ||
    proof.objectKey !== object.objectKey ||
    !proof.producerId
  )
    return { phase: "blocked", reason: "deletion_ownership_unconfirmed" };
  if (!checkpoint) return { phase: "blocked", reason: "journal_unavailable" };
  try {
    if (object.payload.credentialRef === null)
      return { phase: "blocked", reason: "credential_unavailable" };
    const authorization = await resolveBuilderRequestAuthorization({
      requiredScope: BUILDER_ASSETS_WRITE_SCOPE,
    });
    if (!authorization)
      return { phase: "blocked", reason: "credential_unavailable" };
    const publicKey =
      authorization.legacyPublicKey ?? authorization.oauthSelectedPublicKey;
    if (publicKey !== space)
      return { phase: "blocked", reason: "credential_space_mismatch" };
    const credentialRef = builderCredentialRef(authorization);
    if (
      object.payload.credentialRef &&
      object.payload.credentialRef !== credentialRef
    )
      return { phase: "blocked", reason: "credential_connection_changed" };
    let payload = { ...object.payload, credentialRef };
    if (!payload.acceptedAt || payload.needsDeleteRetry) {
      if (!payload.registeredUrl) {
        await checkpoint({ phase: "register_sent", payload });
        const endpoint = new URL(
          "https://cdn.builder.io/api/v1/upload/complete",
        );
        endpoint.searchParams.set("apiKey", space);
        const registered = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: authorization.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            assetId,
            recordAsset: true,
            skipCompression: true,
          }),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
        if (!registered.ok) {
          await registered.body?.cancel();
          return {
            phase: "pending",
            reason: "registration_unconfirmed",
            httpStatus: registered.status,
          };
        }
        const data: unknown = await registered.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("id" in data) ||
          data.id !== assetId ||
          !("url" in data) ||
          typeof data.url !== "string" ||
          builderObjectKey(data.url) !== object.objectKey
        )
          return { phase: "blocked", reason: "registered_identity_mismatch" };
        payload = { ...payload, registeredUrl: data.url };
        await checkpoint({ phase: "registered", payload });
      }
      if (
        !payload.registeredUrl ||
        builderObjectKey(payload.registeredUrl) !== object.objectKey
      )
        return { phase: "blocked", reason: "registered_identity_mismatch" };
      const endpoint = new URL("https://cdn.builder.io/api/v1/assets/by-url");
      endpoint.searchParams.set("apiKey", space);
      endpoint.searchParams.set("url", payload.registeredUrl);
      await checkpoint({ phase: "delete_sent", payload });
      const removed = await fetch(endpoint, {
        method: "DELETE",
        headers: { Authorization: authorization.authorization },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      await removed.body?.cancel();
      if (!removed.ok)
        return {
          phase: "pending",
          reason: "delete_unconfirmed",
          httpStatus: removed.status,
          payload: withoutRegisteredUrl(payload),
        };
      payload = { ...payload, acceptedAt: Date.now(), needsDeleteRetry: false };
      await checkpoint({
        phase: "provider_accepted",
        payload,
        httpStatus: removed.status,
      });
      return {
        phase: "pending",
        reason: "awaiting_serving_verification",
        payload,
      };
    }
    // The observed 67–69s cache sample is a lower bound, not a global invalidation deadline.
    if (Date.now() - payload.acceptedAt < 120_000)
      return {
        phase: "pending",
        reason: "awaiting_serving_verification",
        payload,
      };
    let servingStatus = 404;
    for (const url of payload.urls) {
      const probe = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      servingStatus = probe.status;
      await probe.body?.cancel();
      if (probe.ok)
        return {
          phase: "pending",
          reason: "still_serving",
          servingStatus,
          payload: { ...withoutRegisteredUrl(payload), needsDeleteRetry: true },
        };
      if (![404, 410].includes(probe.status))
        return {
          phase: "pending",
          reason: "serving_state_unconfirmed",
          servingStatus,
          payload,
        };
    }
    // This records absence at the checked serving URLs; it is not a provider inventory of unknown variants.
    return {
      phase: "complete",
      servingStatus,
      payload,
    };
  } catch {
    return { phase: "pending", reason: "provider_unavailable" };
  }
}
