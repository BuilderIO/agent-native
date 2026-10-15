import crypto from "node:crypto";
import path from "node:path";

export const LOCALHOST_BRIDGE_OPERATION_CAPABILITY_FIELD =
  "bridgeOperationCapability";

const CAPABILITY_TTL_MS = 120_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_CANONICAL_BODY_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const CAPABILITY_DOMAIN = "agent-native:visual-edit-bridge-operation:v2\0";
const AUDIENCE_DOMAIN = "agent-native:visual-edit-bridge-audience:v1\0";

type CapabilityClaims = {
  version: 2;
  audience: string;
  operation: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  bodyHash: string;
};

export interface IssueLocalhostBridgeOperationCapabilityOptions {
  bridgeToken: string;
  audience: string;
  operation: string;
  body: Record<string, unknown>;
  issuedAt?: number;
}

export interface VerifyLocalhostBridgeOperationCapabilityOptions {
  bridgeToken: string;
  audience: string;
  operation: string;
  body: Record<string, unknown>;
  capability: string;
  now?: number;
}

function base64UrlEncode(value: Buffer | string): string {
  return (typeof value === "string" ? Buffer.from(value, "utf8") : value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4),
    "base64",
  );
  return base64UrlEncode(decoded) === value ? decoded : null;
}

function canonicalJson(value: unknown, depth = 0, root = false): string {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error("bridge capability body exceeds the JSON depth limit");
  }

  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("bridge capability body contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error("bridge capability body contains a non-JSON array");
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)),
      )
    ) {
      throw new Error("bridge capability body contains a non-JSON array");
    }
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new Error("bridge capability body contains a non-JSON array");
      }
      items.push(canonicalJson(descriptor.value, depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new Error("bridge capability body contains a non-JSON value");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("bridge capability body contains a non-JSON object");
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("bridge capability body contains a non-JSON object");
  }
  const entries = (keys as string[])
    .filter(
      (key) => !(root && key === LOCALHOST_BRIDGE_OPERATION_CAPABILITY_FIELD),
    )
    .sort()
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new Error("bridge capability body contains an accessor");
      }
      return `${JSON.stringify(key)}:${canonicalJson(
        descriptor.value,
        depth + 1,
      )}`;
    });
  return `{${entries.join(",")}}`;
}

function canonicalBodyHash(body: Record<string, unknown>): string {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (Object.getPrototypeOf(body) !== Object.prototype &&
      Object.getPrototypeOf(body) !== null)
  ) {
    throw new Error("bridge capability body must be a JSON object");
  }
  const canonical = canonicalJson(body, 0, true);
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BODY_BYTES) {
    throw new Error("bridge capability body exceeds the size limit");
  }
  return base64UrlEncode(
    crypto.createHash("sha256").update(canonical, "utf8").digest(),
  );
}

function assertOperation(operation: string) {
  if (
    typeof operation !== "string" ||
    operation.length === 0 ||
    operation.length > 512
  ) {
    throw new Error("bridge capability operation is invalid");
  }
}

function canonicalBridgeRootPath(rootPath: string): string {
  if (
    typeof rootPath !== "string" ||
    rootPath.length === 0 ||
    rootPath !== rootPath.trim() ||
    rootPath.length > 32_768
  ) {
    throw new Error("bridge root path is invalid");
  }

  // Use the platform-independent path implementation for the path syntax so
  // a cloud server and a local Windows CLI derive the same audience.
  if (
    (/^[A-Za-z]:[\\/]/.test(rootPath) || rootPath.startsWith("\\\\")) &&
    path.win32.isAbsolute(rootPath)
  ) {
    const normalized = path.win32.normalize(rootPath).replace(/\\/g, "/");
    const canonicalRoot = path.win32.parse(rootPath).root.replace(/\\/g, "/");
    return normalized.length > canonicalRoot.length
      ? normalized.replace(/\/+$/, "")
      : normalized;
  }
  if (path.posix.isAbsolute(rootPath)) {
    const normalized = path.posix.normalize(rootPath);
    return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
  }
  throw new Error("bridge root path must be absolute");
}

export function createLocalhostBridgeAudience(rootPath: string): string {
  return crypto
    .createHash("sha256")
    .update(AUDIENCE_DOMAIN, "utf8")
    .update(canonicalBridgeRootPath(rootPath), "utf8")
    .digest("base64url");
}

function signPayload(bridgeToken: string, encodedPayload: string): string {
  return base64UrlEncode(
    crypto
      .createHmac("sha256", bridgeToken)
      .update(CAPABILITY_DOMAIN, "utf8")
      .update(encodedPayload, "ascii")
      .digest(),
  );
}

export function issueLocalhostBridgeOperationCapability({
  bridgeToken,
  audience,
  operation,
  body,
  issuedAt = Date.now(),
}: IssueLocalhostBridgeOperationCapabilityOptions): {
  capability: string;
  nonce: string;
  expiresAt: number;
} {
  if (typeof bridgeToken !== "string" || bridgeToken.length === 0) {
    throw new Error("bridge token is required");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(audience)) {
    throw new Error("bridge capability audience is invalid");
  }
  assertOperation(operation);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
    throw new Error("bridge capability issuance time is invalid");
  }

  const claims: CapabilityClaims = {
    version: 2,
    audience,
    operation,
    issuedAt,
    expiresAt: issuedAt + CAPABILITY_TTL_MS,
    nonce: base64UrlEncode(crypto.randomBytes(32)),
    bodyHash: canonicalBodyHash(body),
  };
  if (!Number.isSafeInteger(claims.expiresAt)) {
    throw new Error("bridge capability expiration time is invalid");
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  return {
    capability: `${encodedPayload}.${signPayload(bridgeToken, encodedPayload)}`,
    nonce: claims.nonce,
    expiresAt: claims.expiresAt,
  };
}

export function verifyLocalhostBridgeOperationCapability({
  bridgeToken,
  audience,
  operation,
  body,
  capability,
  now = Date.now(),
}: VerifyLocalhostBridgeOperationCapabilityOptions): {
  nonce: string;
  expiresAt: number;
} | null {
  try {
    if (
      typeof bridgeToken !== "string" ||
      bridgeToken.length === 0 ||
      typeof capability !== "string" ||
      capability.length > 4096 ||
      !/^[A-Za-z0-9_-]{43}$/.test(audience) ||
      !Number.isSafeInteger(now)
    ) {
      return null;
    }
    assertOperation(operation);
    const segments = capability.split(".");
    if (segments.length !== 2) return null;
    const payloadBytes = base64UrlDecode(segments[0] ?? "");
    const signature = base64UrlDecode(segments[1] ?? "");
    if (!payloadBytes || !signature || signature.length !== 32) return null;
    const expectedSignature = base64UrlDecode(
      signPayload(bridgeToken, segments[0] ?? ""),
    );
    if (
      !expectedSignature ||
      !crypto.timingSafeEqual(signature, expectedSignature)
    ) {
      return null;
    }

    const claims = JSON.parse(
      payloadBytes.toString("utf8"),
    ) as Partial<CapabilityClaims>;
    if (
      claims.version !== 2 ||
      claims.audience !== audience ||
      claims.operation !== operation ||
      !Number.isSafeInteger(claims.issuedAt) ||
      !Number.isSafeInteger(claims.expiresAt) ||
      typeof claims.nonce !== "string" ||
      typeof claims.bodyHash !== "string" ||
      claims.expiresAt !== (claims.issuedAt as number) + CAPABILITY_TTL_MS ||
      (claims.issuedAt as number) > now + MAX_CLOCK_SKEW_MS ||
      (claims.expiresAt as number) <= now ||
      !/^[A-Za-z0-9_-]{43}$/.test(claims.nonce) ||
      !/^[A-Za-z0-9_-]{43}$/.test(claims.bodyHash)
    ) {
      return null;
    }
    const allowedKeys = [
      "version",
      "audience",
      "operation",
      "issuedAt",
      "expiresAt",
      "nonce",
      "bodyHash",
    ];
    if (
      Object.keys(claims).length !== allowedKeys.length ||
      Object.keys(claims).some((key) => !allowedKeys.includes(key))
    ) {
      return null;
    }
    if (canonicalBodyHash(body) !== claims.bodyHash) return null;

    return {
      nonce: claims.nonce,
      expiresAt: claims.expiresAt as number,
    };
    // coercion-ok: malformed capability claims are an explicit authorization denial; null never grants access.
  } catch {
    return null;
  }
}
