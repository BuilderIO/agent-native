import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

import type {
  CreativeContextElementProvenance,
  CreativeContextReuseLabel,
} from "../types.js";

export interface GenerationArtifactIdentity {
  appId: string;
  artifactType: string;
  artifactId: string;
}

export type GenerationArtifactAccessOperation = "read" | "record";

export interface GenerationArtifactAccessTarget {
  resourceType: string;
  resourceId: string;
  recordMinRole?: "viewer" | "editor";
}

const proofBrand = Symbol("creative-context-generation-artifact-access");

export interface GenerationArtifactAccessProof {
  readonly identityKey: string;
  readonly operation: GenerationArtifactAccessOperation;
  readonly verifiedRole: "viewer" | "editor";
  readonly [proofBrand]: true;
}

interface CapabilityClaims {
  version: 1;
  operation: GenerationArtifactAccessOperation;
  identityKey: string;
  minRole: "viewer" | "editor";
  resourceType: string;
  resourceId: string;
  userEmail: string;
  orgId: string | null;
  expiresAt: number;
}

const CAPABILITY_LIFETIME_MS = 60_000;
const SNAPSHOT_CAPABILITY_LIFETIME_MS = 5 * 60_000;

export type GenerationCreativeContextSnapshot = GenerationArtifactIdentity & {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
  elementProvenance?: CreativeContextElementProvenance[];
  onlyIfMissing: true;
};

interface SnapshotCapabilityClaims {
  version: 1;
  operation: "record-validated-snapshot";
  identityKey: string;
  snapshotDigest: string;
  userEmail: string;
  orgId: string | null;
  expiresAt: number;
}

export function generationArtifactAccessRole(
  target: GenerationArtifactAccessTarget,
  operation: GenerationArtifactAccessOperation,
): "viewer" | "editor" {
  if (operation === "read") return "viewer";
  return target.recordMinRole ?? "editor";
}

export async function assertGenerationArtifactAccess(
  identity: GenerationArtifactIdentity,
  target: GenerationArtifactAccessTarget,
  operation: GenerationArtifactAccessOperation,
): Promise<GenerationArtifactAccessProof> {
  const minRole = generationArtifactAccessRole(target, operation);
  await assertAccess(
    target.resourceType,
    target.resourceId,
    minRole,
    undefined,
    {
      skipResourceBody: true,
    },
  );
  return createProof(identity, operation, minRole);
}

export function assertGenerationArtifactAccessProof(
  identity: GenerationArtifactIdentity,
  proof: GenerationArtifactAccessProof,
  operation: GenerationArtifactAccessOperation,
): void {
  if (
    proof?.[proofBrand] !== true ||
    proof.identityKey !== generationIdentityKey(identity) ||
    (operation === "record" && proof.operation !== "record")
  ) {
    throw new Error(
      "Generation artifact access must be verified by the host application",
    );
  }
}

export async function createGenerationArtifactAccessCapability(
  identity: GenerationArtifactIdentity,
  target: GenerationArtifactAccessTarget,
  operation: GenerationArtifactAccessOperation,
): Promise<string> {
  const minRole = generationArtifactAccessRole(target, operation);
  await assertGenerationArtifactAccess(identity, target, operation);
  const actor = requireCapabilityActor();
  const claims: CapabilityClaims = {
    version: 1,
    operation,
    identityKey: generationIdentityKey(identity),
    minRole,
    resourceType: target.resourceType,
    resourceId: target.resourceId,
    userEmail: actor.userEmail,
    orgId: actor.orgId,
    expiresAt: Date.now() + CAPABILITY_LIFETIME_MS,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const signature = await signCapability(encoded);
  return `${encoded}.${signature}`;
}

export async function verifyGenerationArtifactAccessCapability(
  token: string,
  identity: GenerationArtifactIdentity,
  operation: GenerationArtifactAccessOperation,
): Promise<GenerationArtifactAccessProof> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) {
    throw new Error("Invalid generation artifact access capability");
  }
  const valid = await verifyCapabilitySignature(encoded, signature);
  if (!valid) throw new Error("Invalid generation artifact access capability");

  let claims: CapabilityClaims;
  try {
    claims = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as CapabilityClaims;
  } catch {
    throw new Error("Invalid generation artifact access capability");
  }
  const actor = requireCapabilityActor();
  // The recorded role is read back from the claims rather than re-derived,
  // because only the mint side saw the target that decided it. That is safe
  // because these claims are HMAC-signed by this deployment and the real
  // `assertAccess` ran before signing. The checks below are what keep a token
  // from being replayed for another artifact, operation, caller, org, or
  // moment.
  if (
    claims.version !== 1 ||
    claims.operation !== operation ||
    claims.identityKey !== generationIdentityKey(identity) ||
    (claims.minRole !== "viewer" && claims.minRole !== "editor") ||
    (operation === "read" && claims.minRole !== "viewer") ||
    claims.userEmail !== actor.userEmail ||
    claims.orgId !== actor.orgId ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt < Date.now() ||
    claims.expiresAt > Date.now() + CAPABILITY_LIFETIME_MS
  ) {
    throw new Error("Invalid generation artifact access capability");
  }
  return createProof(identity, operation, claims.minRole);
}

export async function createGenerationCreativeContextSnapshotCapability(
  snapshot: GenerationCreativeContextSnapshot,
): Promise<string> {
  if (snapshot.onlyIfMissing !== true) {
    throw new Error("Creative Context snapshot receipts require onlyIfMissing");
  }
  const actor = requireCapabilityActor();
  const claims: SnapshotCapabilityClaims = {
    version: 1,
    operation: "record-validated-snapshot",
    identityKey: generationIdentityKey(snapshot),
    snapshotDigest: await generationSnapshotDigest(snapshot),
    userEmail: actor.userEmail,
    orgId: actor.orgId,
    expiresAt: Date.now() + SNAPSHOT_CAPABILITY_LIFETIME_MS,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${await signCapability(encoded)}`;
}

export async function verifyGenerationCreativeContextSnapshotCapability(
  token: string,
  snapshot: GenerationCreativeContextSnapshot,
): Promise<void> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) {
    throw new Error("Invalid Creative Context snapshot capability");
  }
  const valid = await verifyCapabilitySignature(encoded, signature);
  if (!valid) {
    throw new Error("Invalid Creative Context snapshot capability");
  }

  let claims: SnapshotCapabilityClaims;
  try {
    claims = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SnapshotCapabilityClaims;
  } catch {
    throw new Error("Invalid Creative Context snapshot capability");
  }
  const actor = requireCapabilityActor();
  if (
    claims.version !== 1 ||
    claims.operation !== "record-validated-snapshot" ||
    claims.identityKey !== generationIdentityKey(snapshot) ||
    claims.snapshotDigest !== (await generationSnapshotDigest(snapshot)) ||
    claims.userEmail !== actor.userEmail ||
    claims.orgId !== actor.orgId ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt < Date.now() ||
    claims.expiresAt > Date.now() + SNAPSHOT_CAPABILITY_LIFETIME_MS
  ) {
    throw new Error("Invalid Creative Context snapshot capability");
  }
}

function createProof(
  identity: GenerationArtifactIdentity,
  operation: GenerationArtifactAccessOperation,
  verifiedRole: "viewer" | "editor",
): GenerationArtifactAccessProof {
  return Object.freeze({
    identityKey: generationIdentityKey(identity),
    operation,
    verifiedRole,
    [proofBrand]: true as const,
  });
}

function generationIdentityKey(identity: GenerationArtifactIdentity): string {
  return JSON.stringify([
    identity.appId,
    identity.artifactType,
    identity.artifactId,
  ]);
}

async function generationSnapshotDigest(
  snapshot: GenerationCreativeContextSnapshot,
): Promise<string> {
  const canonicalSnapshot = JSON.stringify({
    appId: snapshot.appId,
    artifactType: snapshot.artifactType,
    artifactId: snapshot.artifactId,
    contextMode: snapshot.contextMode,
    contextPackId: snapshot.contextPackId,
    reuseLabels: snapshot.reuseLabels.map((label) => ({
      itemId: label.itemId,
      itemVersionId: label.itemVersionId,
      kind: label.kind,
      label: label.label,
      dataRole: label.dataRole,
      elementId: label.elementId,
      influence: label.influence,
    })),
    elementProvenance: snapshot.elementProvenance?.map((entry) => ({
      elementId: entry.elementId,
      influence: entry.influence,
      itemId: entry.itemId,
      itemVersionId: entry.itemVersionId,
      label: entry.label,
    })),
    onlyIfMissing: snapshot.onlyIfMissing,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalSnapshot),
  );
  return Buffer.from(digest).toString("base64url");
}

function requireCapabilityActor(): {
  userEmail: string;
  orgId: string | null;
} {
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!userEmail) throw new Error("Not authenticated");
  return { userEmail, orgId: getRequestOrgId() ?? null };
}

function capabilitySecret(): string {
  const secret =
    process.env.CREATIVE_CONTEXT_A2A_KEY?.trim() ||
    process.env.A2A_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Generation artifact access capabilities require CREATIVE_CONTEXT_A2A_KEY or A2A_SECRET",
    );
  }
  return secret;
}

async function signCapability(encoded: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(capabilitySecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded),
  );
  return Buffer.from(signature).toString("base64url");
}

async function verifyCapabilitySignature(
  encoded: string,
  signature: string,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(signature, "base64url");
    if (Buffer.from(bytes).toString("base64url") !== signature) return false;
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(capabilitySecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes as unknown as BufferSource,
    new TextEncoder().encode(encoded),
  );
}
