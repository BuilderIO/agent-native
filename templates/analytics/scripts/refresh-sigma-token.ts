/**
 * Refreshes the Sigma Computing MCP access token in the org settings.
 *
 * Run this whenever the Sigma MCP token expires (~1 hour):
 *   pnpm script refresh-sigma-token
 *
 * The server picks up the new token automatically on the next MCP reconnect.
 */

import { parseArgs, loadEnv } from "@agent-native/core";
import postgres from "postgres";

const SIGMA_TOKEN_URL = "https://aws-api.sigmacomputing.com/v2/auth/token";
const SIGMA_MCP_URL = "https://aws-api.sigmacomputing.com/mcp/v2";
const ORG_ID = "PlRt3bfcpJNnOyF_Wfgsh";
const SETTINGS_KEY = `o:${ORG_ID}:mcp-servers-remote`;

export default async function main(_args: string[]) {
  loadEnv();

  const clientId = process.env.SIGMA_CLIENT_ID;
  const clientSecret = process.env.SIGMA_CLIENT_SECRET;
  const dbUrl = process.env.ANALYTICS_DATABASE_URL;

  if (!clientId || !clientSecret) {
    throw new Error("SIGMA_CLIENT_ID and SIGMA_CLIENT_SECRET must be set");
  }
  if (!dbUrl) {
    throw new Error("ANALYTICS_DATABASE_URL must be set");
  }

  console.log("Fetching fresh Sigma token...");
  const tokenRes = await fetch(SIGMA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token fetch failed: ${tokenRes.status}`);
  }

  const { access_token, expires_in } = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
  };

  console.log(
    `Token obtained (expires in ${expires_in}s ~${Math.round(expires_in / 60)} min)`,
  );

  const sql = postgres(dbUrl, { ssl: "require", max: 1 });
  const now = new Date().toISOString();

  const server = {
    id: "mcps_sigma",
    name: "sigma",
    url: SIGMA_MCP_URL,
    headers: { Authorization: `Bearer ${access_token}` },
    description: "Sigma Computing MCP",
    createdAt: Date.now(),
  };
  const value = JSON.stringify({ servers: [server] });

  await sql`INSERT INTO settings (key, value, updated_at) VALUES (${SETTINGS_KEY}, ${value}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = ${now}`;

  await sql.end();
  console.log("✓ Sigma MCP token refreshed in org settings");
  console.log(
    "  Restart the dev server or wait for MCP reconnect to take effect.",
  );
}
