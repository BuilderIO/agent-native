import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

export interface GenerationArtifactIdentity {
  appId: string;
  artifactType: string;
  artifactId: string;
}

export interface GenerationArtifactAccessTarget {
  resourceType: string;
  resourceId: string;
}

const proofBrand = Symbol("creative-context-generation-artifact-access");

export interface GenerationArtifactAccessProof {
  readonly identityKey: string;
  readonly minRole: "viewer" | "editor";
  readonly [proofBrand]: true;
}

interface CapabilityClaims {
  version: 1;
  operation: "read" | "record";
  identityKey: string;
  minRole: "viewer" | "editor";
  resourceType: string;
  resourceId: string;
  userEmail: string;
  orgId: string | null;
  expiresAt: number;
}

const CAPABILITY_LIFETIME_MS = 60_000;

export async function assertGenerationArtifactAccess(
  identity: GenerationArtifactIdentity,
  target: GenerationArtifactAccessTarget,
  minRole: "viewer" | "editor",
): Promise<GenerationArtifactAccessProof> {
  await assertAccess(
    target.resourceType,
    target.resourceId,
    minRole,
    undefined,
    {
      skipResourceBody: true,
    },
  );
  return createProof(identity, minRole);
}

export function assertGenerationArtifactAccessProof(
  identity: GenerationArtifactIdentity,
  proof: GenerationArtifactAccessProof,
  minRole: "viewer" | "editor",
): void {
  if (
    proof?.[proofBrand] !== true ||
    proof.identityKey !== generationIdentityKey(identity) ||
    (minRole === "editor" && proof.minRole !== "editor")
  ) {
    throw new Error(
      "Generation artifact access must be verified by the host application",
    );
  }
}

export async function createGenerationArtifactAccessCapability(
  identity: GenerationArtifactIdentity,
  target: GenerationArtifactAccessTarget,
  operation: "read" | "record",
): Promise<string> {
  const minRole = operation === "record" ? "editor" : "viewer";
  await assertGenerationArtifactAccess(identity, target, minRole);
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
  operation: "read" | "record",
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
  const expectedRole = operation === "record" ? "editor" : "viewer";
  if (
    claims.version !== 1 ||
    claims.operation !== operation ||
    claims.identityKey !== generationIdentityKey(identity) ||
    claims.minRole !== expectedRole ||
    claims.userEmail !== actor.userEmail ||
    claims.orgId !== actor.orgId ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt < Date.now() ||
    claims.expiresAt > Date.now() + CAPABILITY_LIFETIME_MS
  ) {
    throw new Error("Invalid generation artifact access capability");
  }
  return createProof(identity, expectedRole);
}

function createProof(
  identity: GenerationArtifactIdentity,
  minRole: "viewer" | "editor",
): GenerationArtifactAccessProof {
  return Object.freeze({
    identityKey: generationIdentityKey(identity),
    minRole,
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
