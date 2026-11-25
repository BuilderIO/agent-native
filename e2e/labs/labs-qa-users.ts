import { createHmac } from "node:crypto";

import {
  verificationLinkFor,
  waitForVerificationEmail,
  type MailosaurMessage,
} from "../signup/lib/mailosaur.ts";

const host = (process.env.QA_HOST?.trim() || "labs.agent-native.com").replace(
  /^https?:\/\//,
  "",
);
const origin = `https://${host}`;
const probeApp = process.env.QA_PROBE_APP?.trim() || "forms-2";
const slots = (process.env.QA_SLOTS?.trim() || "1,2,3,4,5")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const probeOnly = process.env.QA_PROBE === "1";

const apiKey = process.env.MAILOSAUR_API_KEY?.trim() ?? "";
const serverId = process.env.MAILOSAUR_SERVER_ID?.trim() ?? "";
if (!apiKey || !serverId) {
  throw new Error("MAILOSAUR_API_KEY and MAILOSAUR_SERVER_ID are required.");
}

const secrets = new Set<string>();
function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("***");
  return out
    .replace(/token=[^&\s"']+/gi, "token=***")
    .replace(/("(?:token|password|newPassword)"\s*:\s*")[^"]*/gi, "$1***");
}
function log(line: string) {
  console.log(redact(line));
}

export function derive(user: string): string {
  const password =
    createHmac("sha256", apiKey).update(user).digest("hex").slice(0, 32) +
    "!Aa1";
  secrets.add(password);
  console.log(`::add-mask::${password}`);
  return password;
}

type Jar = Map<string, string>;
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
function cookieHeader(jar: Jar): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function call(
  jar: Jar,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  absorb(jar, res);
  return { status: res.status, text: await res.text() };
}

const authBase = `${origin}/${probeApp}/_agent-native/auth`;
const ba = (path: string) => `${authBase}/ba${path}`;

class StepError extends Error {}
function fail(step: string, r: { status: number; text: string }): never {
  throw new StepError(`${step}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
}

async function sessionEmail(jar: Jar): Promise<string | undefined> {
  const r = await call(jar, "GET", `${authBase}/session`);
  if (r.status !== 200) return undefined;
  try {
    return (JSON.parse(r.text) as { email?: string }).email?.toLowerCase();
    // coercion-ok: a non-JSON session body means not signed in
  } catch {
    return undefined;
  }
}

async function signIn(jar: Jar, email: string, password: string) {
  const r = await call(jar, "POST", ba("/sign-in/email"), { email, password });
  if (r.status >= 500) fail("sign-in", r);
  const ok = r.status === 200 && (await sessionEmail(jar)) === email;
  return { ok, r };
}

async function followLink(jar: Jar, link: string) {
  let url = link;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: jar.size ? { Cookie: cookieHeader(jar) } : {},
      signal: AbortSignal.timeout(45_000),
    });
    absorb(jar, res);
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString();
      continue;
    }
    return res.status;
  }
  return 0;
}

function resetToken(message: MailosaurMessage): string {
  const bodies = [message.html?.body, message.text?.body].filter(
    (b): b is string => Boolean(b),
  );
  const urls = [
    ...(message.html?.links ?? []),
    ...(message.text?.links ?? []),
  ].map((l) => l.href ?? "");
  for (const b of bodies)
    urls.push(...(b.match(/https?:\/\/[^\s"'<>]+/g) ?? []));
  for (const raw of urls) {
    try {
      const u = new URL(raw.replace(/&amp;/g, "&"));
      const q = u.searchParams.get("token");
      if (q) return q;
      const m = u.pathname.match(/reset-password\/([^/?]+)/);
      if (m) return decodeURIComponent(m[1]);
      // coercion-ok: link text that is not a URL carries no token
    } catch {
      continue;
    }
  }
  throw new StepError("password-reset: no token in reset email");
}

export function qaIdentity(slot: string): { email: string; password: string } {
  const user = `qa-fleet-${slot}`;
  return {
    email: `${user}@${serverId}.mailosaur.net`.toLowerCase(),
    password: derive(user),
  };
}

export async function ensureUser(slot: string): Promise<Jar> {
  const { email, password } = qaIdentity(slot);
  const jar: Jar = new Map();

  let attempt = await signIn(jar, email, password);
  if (attempt.ok) {
    log(`USER qa-fleet-${slot}: existing, signed in`);
    return jar;
  }

  const requestedAt = Date.now() - 5_000;
  const up = await call(jar, "POST", ba("/sign-up/email"), {
    email,
    password,
    name: "QA Fleet",
  });
  if (up.status !== 200) {
    if (up.status >= 500) fail("sign-up", up);
    const rr = Date.now() - 5_000;
    const req = await call(jar, "POST", ba("/request-password-reset"), {
      email,
      redirectTo: `${origin}/${probeApp}/`,
    });
    if (req.status !== 200) fail("request-password-reset", req);
    const msg = await waitForVerificationEmailOrReset(email, rr);
    const token = resetToken(msg);
    const reset = await call(jar, "POST", ba("/reset-password"), {
      newPassword: password,
      token,
    });
    if (reset.status !== 200) fail("reset-password", reset);
    console.log(`::warning::password-reset qa-fleet-${slot}`);
    attempt = await signIn(jar, email, password);
    if (!attempt.ok) fail("sign-in after reset", attempt.r);
    return jar;
  }

  if ((await sessionEmail(jar)) !== email) {
    const msg = await waitForVerificationEmail(email, requestedAt);
    const link = verificationLinkFor(msg, origin);
    const status = await followLink(jar, link);
    log(`USER qa-fleet-${slot}: verification link followed (HTTP ${status})`);
  }
  attempt = await signIn(jar, email, password);
  if (!attempt.ok) fail("sign-in after verification", attempt.r);
  log(`USER qa-fleet-${slot}: created and verified`);
  return jar;
}

async function waitForVerificationEmailOrReset(email: string, after: number) {
  const { waitForVerificationEmail: wait } =
    await import("../signup/lib/mailosaur.ts");
  return wait(email, after);
}

async function action(
  jar: Jar,
  name: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) {
  const base = `${origin}/${probeApp}/_agent-native/actions/${name}`;
  if (method === "GET") {
    const qs = new URLSearchParams(
      Object.entries(body ?? {}).map(([k, v]) => [k, String(v)]),
    );
    return call(jar, "GET", qs.size ? `${base}?${qs}` : base);
  }
  return call(jar, "POST", base, body ?? {});
}

async function seedAndReadBack(jar: Jar, slot: string) {
  const name = `qa-tmp-probe-${slot}-${Date.now()}`;
  const created = await action(jar, "create-form", "POST", { name });
  if (created.status !== 200) fail("seed create-form", created);
  const id = (JSON.parse(created.text) as { id?: string }).id;
  if (!id) fail("seed create-form (no id)", created);
  const read = await action(jar, "get-form", "GET", { id });
  if (read.status !== 200) fail("read-back get-form", read);
  const del = await action(jar, "delete-form", "POST", { id });
  if (del.status !== 200) fail("cleanup delete-form", del);
  return { id, name };
}

async function main() {
  const failed: string[] = [];
  let ok = 0;
  for (const slot of slots) {
    try {
      const jar = await ensureUser(slot);
      if (probeOnly) {
        const seeded = await seedAndReadBack(jar, slot);
        log(`PROBE: PASS seeded+read back+deleted ${seeded.name}`);
      }
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`PROBE: FAIL qa-fleet-${slot} ${msg}`);
      failed.push(slot);
    }
  }
  log(`USERS: ${ok}/${slots.length} on ${host}`);
  if (failed.length) process.exit(1);
}

if (import.meta.main) await main();
