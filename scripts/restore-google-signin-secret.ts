/**
 * Repair Google sign-in across the fleet after a client secret is revoked.
 *
 * Written after 2026-08-22, when a secret on the shared client was deleted and
 * eleven hosts - including production CRM - began answering `invalid_client`.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * 1. A broken host answers `/_agent-native/health/google` with HTTP **503**
 *    and a JSON body saying `status: "invalid"`. Treating a non-2xx as
 *    "unreachable" silently skips exactly the hosts this repairs. The first
 *    draft of this script did that and would have reported "nothing broken".
 * 2. If no host could be probed at all, that is a failed run, not a clean one.
 *    It exits non-zero rather than printing reassurance.
 * 3. The secret is written through the API in a request body, never as a
 *    process argument, and is read from stdin so it stays out of shell history.
 *
 * Netlify bakes env into the function bundle at build time, so a write alone
 * changes nothing until the site redeploys. Beta redeploys on the next merge to
 * main; production sites are listed for the manual production workflow.
 *
 * Usage: tsx scripts/restore-google-signin-secret.ts [--dry-run]
 *        (paste the secret when prompted; NETLIFY_AUTH_TOKEN or a logged-in
 *         `netlify` CLI provides the API token)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const DRY_RUN = process.argv.includes("--dry-run");
const ACCOUNT = "builder-io";
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

interface HealthBody {
  status?: string;
  reason?: string;
  clientId?: string;
}

function netlifyToken(): string {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  // Where the CLI parks its token after `netlify login`, per platform.
  const candidates = [
    `${homedir()}/Library/Preferences/netlify/config.json`,
    `${homedir()}/.config/netlify/config.json`,
    `${homedir()}/.netlify/config.json`,
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      users?: Record<string, { auth?: { token?: string } }>;
    };
    const token = Object.values(config.users ?? {})
      .map((user) => user.auth?.token)
      .find(Boolean);
    if (token) return token;
  }
  throw new Error(
    "No Netlify token. Set NETLIFY_AUTH_TOKEN or run `netlify login`.",
  );
}

const TOKEN = netlifyToken();

async function netlify<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.netlify.com/api/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Netlify ${path} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

/** listSites is paginated; a single page silently hides sites past the first. */
async function allSites(): Promise<
  {
    id: string;
    name: string;
    custom_domain?: string;
    domain_aliases?: string[];
  }[]
> {
  const sites = [];
  for (let page = 1; ; page += 1) {
    const batch = await netlify<typeof sites>(
      `sites?page=${page}&per_page=100`,
    );
    sites.push(...batch);
    if (batch.length < 100) return sites;
  }
}

/**
 * Probe one host. A 503 carrying a JSON body is the BROKEN signal, not a
 * transport failure - the distinction this whole script depends on.
 */
async function probe(
  host: string,
): Promise<{ body?: HealthBody; unreachable?: string }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `https://${host}/_agent-native/health/google`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (response.status === 404) return { body: { status: "absent" } };
      const text = await response.text();
      try {
        return { body: JSON.parse(text) as HealthBody };
      } catch {
        return { unreachable: `unparseable body (http ${response.status})` };
      }
    } catch (error) {
      if (attempt === 3) {
        return {
          unreachable: error instanceof Error ? error.message : String(error),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  return { unreachable: "exhausted attempts" };
}

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    // A closed or piped stdin must fail loudly rather than hang on a prompt
    // nobody can answer.
    throw new Error(
      "stdin is not a terminal; run this interactively so the secret is typed, not argv.",
    );
  }
  process.stderr.write("Paste a currently valid client secret\n(secret): ");
  const rl = createInterface({ input: process.stdin, terminal: true });
  const secret = await new Promise<string>((resolve) =>
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
  process.stderr.write("\n");
  return secret;
}

async function verifyWithGoogle(clientId: string, secret: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      code: "probe-bogus-code",
      grant_type: "authorization_code",
      redirect_uri:
        "https://content.agent-native.com/_agent-native/google/callback",
    }),
  });
  const body = (await response.json()) as { error?: string };
  // invalid_grant means only the code was bad, i.e. the secret is genuinely
  // this client's. invalid_client means it belongs to some other client.
  return body.error === "invalid_grant";
}

let secret: string;
try {
  secret = await readSecret();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (!secret) {
  console.error("Nothing entered; aborting.");
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(`${REPO}/scripts/netlify-site-hosts.json`, "utf8"),
) as Record<string, string[]>;
const hosts = [...(manifest.production ?? []), ...(manifest.beta ?? [])];

console.log(`==> Probing ${hosts.length} hosts...`);
const results = await Promise.all(
  hosts.map(async (host) => ({ host, ...(await probe(host)) })),
);

const unreachable = results.filter((r) => r.unreachable);
const broken = results.filter((r) => r.body?.status === "invalid");
for (const r of broken) {
  console.log(`  BROKEN      ${r.host}  ${r.body?.reason ?? ""}`);
}
for (const r of unreachable) {
  console.log(`  UNREACHABLE ${r.host}  ${r.unreachable}`);
}

// "We could not look" must never render as "nothing is wrong".
if (!broken.length && unreachable.length === results.length) {
  console.error(
    `\nEvery probe failed (${unreachable.length}/${results.length}). ` +
      "Not concluding the fleet is healthy. Nothing written.",
  );
  process.exit(1);
}
if (!broken.length) {
  console.log(
    `\nNothing broken.${unreachable.length ? ` ${unreachable.length} host(s) unreachable - recheck those by hand.` : ""}`,
  );
  process.exit(unreachable.length ? 1 : 0);
}

const clientId = broken.find((r) => r.body?.clientId)?.body?.clientId;
if (!clientId) {
  console.error("Broken hosts reported no client id. Nothing written.");
  process.exit(1);
}
console.log(
  `\n==> Verifying the secret against ${clientId.split("-")[1]?.slice(0, 12)}...`,
);
if (!(await verifyWithGoogle(clientId, secret))) {
  console.error(
    "    Google rejects this secret for that client. Nothing written.",
  );
  process.exit(1);
}
console.log("    OK.");

const sites = await allSites();
const siteByHost = new Map<string, (typeof sites)[number]>();
for (const site of sites) {
  for (const domain of [site.custom_domain, ...(site.domain_aliases ?? [])]) {
    if (domain) siteByHost.set(domain, site);
  }
}

const repaired: string[] = [];
for (const { host } of broken) {
  const site = siteByHost.get(host);
  if (!site) {
    console.log(`  ??      ${host} - no Netlify site matches; repair by hand`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`  DRY     ${site.name}`);
    repaired.push(site.name);
    continue;
  }
  // Secret travels in the request body - never as a process argument.
  await netlify(
    `accounts/${ACCOUNT}/env/GOOGLE_SIGN_IN_CLIENT_SECRET?site_id=${site.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ context: "production", value: secret }),
    },
  );
  console.log(`  SET     ${site.name}`);
  repaired.push(site.name);
}

const productionSites = repaired.filter((name) => !name.startsWith("beta-"));
console.log(
  "\n==> Netlify bakes env at build time, so each site needs a redeploy.\n" +
    "    Beta redeploys on the next merge to main.",
);
if (productionSites.length) {
  console.log(
    `    Production sites needing the manual workflow:\n      ${productionSites.join(", ")}\n` +
      `    gh workflow run deploy-production-sites-prebuilt.yml -f sites=${productionSites
        .map((n) => n.replace(/^agent-native-/, ""))
        .join(",")} -f smoke=true`,
  );
}
