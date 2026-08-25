#!/usr/bin/env tsx
/**
 * Diagnostic: ask Google which redirect URIs a client actually has registered.
 *
 * Google only validates `redirect_uri` after it has resolved a sign-in page, so
 * an unauthenticated request must follow redirects and carry a browser
 * user-agent before `redirect_uri_mismatch` appears in the body. A HEAD or
 * non-following GET returns 302 for registered and unregistered URIs alike,
 * which reads as "everything is fine" — hence the explicit control probe.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export type ProbeVerdict = "registered" | "not-registered" | "indeterminate";

export function classifyProbeBody(body: string): ProbeVerdict {
  if (/redirect_uri_mismatch/i.test(body)) return "not-registered";
  // A real consent/sign-in page is large and never mentions the mismatch.
  if (body.length > 50_000) return "registered";
  return "indeterminate";
}

export async function probeRedirectUri(
  clientId: string,
  redirectUri: string,
): Promise<ProbeVerdict> {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": BROWSER_UA },
  });
  return classifyProbeBody(await response.text());
}

function usage(): string {
  return `Usage:
  pnpm exec tsx scripts/probe-google-redirect-uris.ts --client <client-id> --uri <uri> [--uri <uri> ...]

Always probes a deliberately unregistered control URI first. If the control
does not report "not-registered", the probe is not trustworthy and the run
fails rather than reporting a clean bill of health.
`;
}

export default async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help")) {
    console.log(usage());
    return;
  }
  let clientId = "";
  const uris: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--client") clientId = argv[++i] ?? "";
    else if (argv[i] === "--uri") uris.push(argv[++i] ?? "");
  }
  if (!clientId || !uris.length) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const control = await probeRedirectUri(
    clientId,
    "https://control-not-registered.example.com/cb",
  );
  console.log(`control (expect not-registered): ${control}`);
  if (control !== "not-registered") {
    console.error(
      "Probe is not trustworthy: the control URI was not rejected. Aborting.",
    );
    process.exitCode = 2;
    return;
  }

  for (const uri of uris) {
    const verdict = await probeRedirectUri(clientId, uri);
    console.log(`${verdict.padEnd(16)} ${uri}`);
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
