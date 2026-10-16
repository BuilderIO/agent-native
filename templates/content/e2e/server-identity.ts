import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

/**
 * The ping message that names this run's server. A run that starts the build
 * itself makes one up and hands it to the server as PING_MESSAGE. Otherwise
 * whoever started the server sets the same value there and here. A server
 * that failed to start leaves its port to whatever else listens on it, and
 * without this the run would test that server instead.
 */
export function runServerNonce(serveBuild: boolean): string | undefined {
  // The runner hands its environment to every worker it starts, and each
  // worker loads the config again, so the value lives in the environment.
  // guard:allow-env-mutation — Playwright config, never a server request path.
  if (serveBuild) process.env.CONTENT_E2E_SERVER_NONCE ||= randomUUID();
  return process.env.CONTENT_E2E_SERVER_NONCE;
}

/** Refuse any server whose ping does not answer with this run's nonce. */
export async function expectRunServer(
  request: APIRequestContext,
  baseURL: string,
): Promise<void> {
  const nonce = process.env.CONTENT_E2E_SERVER_NONCE;
  if (!nonce)
    throw new Error(
      `${baseURL} is a server this run did not start, so the run cannot tell it from anything else on that port. Start it with PING_MESSAGE=<nonce> and run with CONTENT_E2E_SERVER_NONCE=<the same nonce>, or set CONTENT_E2E_SERVE_BUILD=1 so the run starts the build itself.`,
    );
  const response = await request.get(`${baseURL}/_agent-native/ping`);
  const text = await response.text();
  const json = (response.headers()["content-type"] ?? "").includes("json");
  const message = response.ok() && json ? JSON.parse(text).message : undefined;
  if (message !== nonce)
    throw new Error(
      `The server at ${baseURL} is not the one this run names: its ping answered ${response.status()} ${JSON.stringify(text.slice(0, 200))}, not the message ${nonce}. Its own server did not start, or another holds the port.`,
    );
}
