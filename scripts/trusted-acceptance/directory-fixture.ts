import { createHmac, timingSafeEqual } from "node:crypto";

export type DirectoryScenario = "stable" | "withdraw-member";

export type DirectoryMember = {
  id: string;
  name: string;
  url: string;
  a2aUrl: string;
  capabilities?: string[];
};

/** Trusted runtime configuration; no request field selects a member or mode. */
export type DirectoryFixtureConfig = {
  orgDomain: string;
  a2aSecret: string;
  fixtureOrigin: string;
  members: readonly DirectoryMember[];
  withdrawnMemberId: string;
};

export type DirectoryRequest = {
  method: string;
  headers?: Headers | Record<string, string | undefined>;
};

export type DirectoryResponse = {
  status: number;
  headers: Record<string, string>;
  body?: { org: string; apps: DirectoryMember[] };
};

function header(
  headers: DirectoryRequest["headers"],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return match?.[1];
}

function isAcceptanceOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      /(?:^|[-.])acceptance(?:[-.]|$)/i.test(url.hostname) &&
      !/(?:^|[-.])(?:prod|production)(?:[-.]|$)/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Validate only the small, allowlisted fixture configuration. */
export function validateDirectoryFixtureConfig(
  config: DirectoryFixtureConfig,
): string[] {
  const issues: string[] = [];
  if (!config.orgDomain.trim()) issues.push("orgDomain must be non-empty");
  if (!config.a2aSecret.trim()) issues.push("a2aSecret must be non-empty");
  if (!isAcceptanceOrigin(config.fixtureOrigin)) {
    issues.push(
      "fixtureOrigin must be a stable non-production acceptance HTTPS origin",
    );
  }
  if (config.members.length === 0) issues.push("members must be non-empty");
  const ids = new Set<string>();
  for (const member of config.members) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(member.id)) {
      issues.push(`member ${member.id || "<empty>"} has an unsafe id`);
    }
    if (ids.has(member.id)) issues.push(`member ${member.id} is duplicated`);
    ids.add(member.id);
    if (!member.name.trim()) issues.push(`member ${member.id} has no name`);
    if (!isAcceptanceOrigin(member.url)) {
      issues.push(`member ${member.id} has an unsafe url`);
    }
    if (!isAcceptanceOrigin(member.a2aUrl)) {
      issues.push(`member ${member.id} has an unsafe a2aUrl`);
    }
  }
  if (
    !config.members.some((member) => member.id === config.withdrawnMemberId)
  ) {
    issues.push("withdrawnMemberId must name a declared member");
  }
  return issues;
}

function unauthorized(): DirectoryResponse {
  return { status: 401, headers: { "Cache-Control": "no-store" } };
}

async function isTrustedCaller(
  authorization: string | undefined,
  config: DirectoryFixtureConfig,
): Promise<boolean> {
  const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return false;
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] =
      token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) {
      return false;
    }
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8"),
    ) as { alg?: unknown };
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (header.alg !== "HS256") return false;
    const actual = Buffer.from(encodedSignature, "base64url");
    const expected = createHmac("sha256", config.a2aSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || now >= payload.exp) return false;
    if (typeof payload.nbf === "number" && now < payload.nbf) return false;
    const scope =
      typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
    const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
    const subjectDomain = subject.includes("@")
      ? subject.slice(subject.lastIndexOf("@") + 1).toLowerCase()
      : undefined;
    const callerDomain =
      typeof payload.org_domain === "string"
        ? payload.org_domain.toLowerCase()
        : subjectDomain;
    return (
      subject.length > 0 &&
      callerDomain === config.orgDomain.toLowerCase() &&
      !scope.includes("identity") &&
      !scope.includes("mcp-connect")
    );
  } catch {
    return false;
  }
}

/**
 * Pure handler for the disposable directory fixture. This deliberately does
 * not mount a route or inspect process configuration; a trusted host supplies
 * a validated config and fixed runtime scenario.
 */
export async function handleDirectoryFixtureRequest(
  request: DirectoryRequest,
  config: DirectoryFixtureConfig,
  scenario: DirectoryScenario,
): Promise<DirectoryResponse> {
  if (request.method !== "GET") return { status: 405, headers: {} };
  if (scenario !== "stable" && scenario !== "withdraw-member") {
    return { status: 400, headers: {} };
  }
  if (validateDirectoryFixtureConfig(config).length > 0) return unauthorized();
  if (
    !(await isTrustedCaller(header(request.headers, "authorization"), config))
  ) {
    return unauthorized();
  }
  const apps =
    scenario === "withdraw-member" && config.withdrawnMemberId
      ? config.members.filter(
          (member) => member.id !== config.withdrawnMemberId,
        )
      : [...config.members];
  return {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: { org: config.orgDomain, apps },
  };
}
