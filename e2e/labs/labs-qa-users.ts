import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import {
  verificationLinkFor,
  waitForVerificationEmail,
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
const fresh = process.env.QA_FRESH === "1";

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

function derive(user: string): string {
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
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      ...extraHeaders,
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
  return (JSON.parse(r.text) as { email?: string }).email?.toLowerCase();
}

async function signIn(jar: Jar, email: string, password: string) {
  const r = await call(jar, "POST", ba("/sign-in/email"), { email, password });
  if (r.status >= 500) fail("sign-in", r);
  const ok = r.status === 200 && (await sessionEmail(jar)) === email;
  return { ok, r };
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function landingForm(html: string, base: string) {
  const form = html.match(
    /<form[^>]*method="post"[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/i,
  );
  if (!form) return undefined;
  const fields = new URLSearchParams();
  for (const input of form[2].matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = input[0].match(/name="([^"]*)"/i)?.[1];
    const value = input[0].match(/value="([^"]*)"/i)?.[1] ?? "";
    if (name) fields.set(unescapeHtml(name), unescapeHtml(value));
  }
  return { action: new URL(unescapeHtml(form[1]), base).toString(), fields };
}

async function followLink(jar: Jar, link: string) {
  let url = link;
  let init: RequestInit = { method: "GET" };
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.method === "POST"
          ? {
              "Content-Type": "application/x-www-form-urlencoded",
              Origin: origin,
            }
          : {}),
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      },
      signal: AbortSignal.timeout(45_000),
    });
    absorb(jar, res);
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString();
      init = { method: "GET" };
      continue;
    }
    const form =
      init.method === "GET" && res.status === 200
        ? landingForm(await res.text(), url)
        : undefined;
    if (!form) return res.status;
    url = form.action;
    init = { method: "POST", body: form.fields.toString() };
  }
  throw new StepError("verification: too many redirects");
}

interface Receipt {
  at: string;
  host: string;
  served_sha: string;
  mailosaur_message_id: string;
  signup_status: number;
  verify_status: number;
  signin_status: number;
  readback: string;
}

async function servedSha(): Promise<string> {
  const res = await fetch(`${origin}/${probeApp}/`, {
    signal: AbortSignal.timeout(45_000),
  });
  return res.headers.get("x-agent-native-build-sha") ?? "absent";
}

async function signUpAndVerify(
  jar: Jar,
  email: string,
  password: string,
): Promise<
  Pick<Receipt, "mailosaur_message_id" | "signup_status" | "verify_status">
> {
  const requestedAt = Date.now() - 5_000;
  const up = await call(jar, "POST", ba("/sign-up/email"), {
    email,
    password,
    name: "QA Fleet",
  });
  if (up.status !== 200) fail("sign-up", up);
  if ((await sessionEmail(jar)) === email) {
    return {
      mailosaur_message_id: "none",
      signup_status: up.status,
      verify_status: 0,
    };
  }
  const msg = await waitForVerificationEmail(email, requestedAt);
  const verifyStatus = await followLink(jar, verificationLinkFor(msg, origin));
  return {
    mailosaur_message_id: msg.id,
    signup_status: up.status,
    verify_status: verifyStatus,
  };
}

export function qaIdentity(slot: string) {
  const user = `qa-fleet-${slot}`;
  const email = `${user}@${serverId}.mailosaur.net`.toLowerCase();
  const password = derive(user);
  return { email, password };
}

export async function ensureUser(slot: string): Promise<Jar> {
  const user = `qa-fleet-${slot}`;
  const { email, password } = qaIdentity(slot);
  const jar: Jar = new Map();

  if ((await signIn(jar, email, password)).ok) {
    log(`USER ${user}: existing, signed in`);
    return jar;
  }

  await signUpAndVerify(jar, email, password);
  const attempt = await signIn(jar, email, password);
  if (!attempt.ok) fail("sign-in after verification", attempt.r);
  log(`USER ${user}: created and verified`);
  return jar;
}

async function freshReceipt(): Promise<Receipt> {
  const user = `qa-tmp-${(process.env.GITHUB_RUN_ID ?? "local").replace(/\W/g, "")}-${randomUUID().slice(0, 8)}`;
  const email = `${user}@${serverId}.mailosaur.net`.toLowerCase();
  const password = derive(user);
  const jar: Jar = new Map();

  const signup = await signUpAndVerify(jar, email, password);
  const attempt = await signIn(jar, email, password);
  if (!attempt.ok) fail("sign-in after verification", attempt.r);
  const seeded = await seedAndReadBack(jar, "fresh");
  return {
    at: new Date().toISOString(),
    host,
    served_sha: await servedSha(),
    ...signup,
    signin_status: attempt.r.status,
    readback: `ok ${seeded.name}`,
  };
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

async function uiAction(
  jar: Jar,
  name: string,
  body: Record<string, unknown>,
) {
  const base = `${origin}/${probeApp}/_agent-native`;
  const minted = await call(jar, "GET", `${base}/ui-capability`);
  if (minted.status !== 200) return minted;
  return call(jar, "POST", `${base}/actions/${name}`, body, {
    "X-Agent-Native-Frontend": "1",
  });
}

async function seedAndReadBack(jar: Jar, slot: string) {
  const name = `qa-tmp-probe-${slot}-${Date.now()}`;
  const created = await action(jar, "create-form", "POST", { name });
  if (created.status !== 200) fail("seed create-form", created);
  const id = (JSON.parse(created.text) as { id?: string }).id;
  if (!id) fail("seed create-form (no id)", created);
  const read = await action(jar, "get-form", "GET", { id });
  if (read.status !== 200) fail("read-back get-form", read);
  const del = await uiAction(jar, "delete-form", { id });
  if (del.status !== 200) fail("cleanup delete-form", del);
  return { id, name };
}

async function main() {
  if (fresh) {
    try {
      const receipt = await freshReceipt();
      mkdirSync("artifacts", { recursive: true });
      writeFileSync(
        "artifacts/labs-qa-receipt.json",
        JSON.stringify(receipt, null, 2),
      );
      log(`PROBE: PASS ${JSON.stringify(receipt)}`);
    } catch (err) {
      log(
        `PROBE: FAIL fresh signup ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    return;
  }
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
