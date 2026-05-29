import postgres from "postgres";

const SIGMA_TOKEN_URL = "https://aws-api.sigmacomputing.com/v2/auth/token";
const SIGMA_MCP_URL = "https://aws-api.sigmacomputing.com/mcp/v2";
const ORG_ID = "PlRt3bfcpJNnOyF_Wfgsh";
const SETTINGS_KEY = `o:${ORG_ID}:mcp-servers-remote`;
// Refresh 10 minutes before the 60-minute expiry
const REFRESH_INTERVAL_MS = 50 * 60 * 1000;

async function refreshSigmaToken() {
  const clientId = process.env.SIGMA_CLIENT_ID;
  const clientSecret = process.env.SIGMA_CLIENT_SECRET;
  const dbUrl = process.env.ANALYTICS_DATABASE_URL;

  if (!clientId || !clientSecret || !dbUrl) return;

  try {
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
      console.error("[sigma] Token refresh failed:", tokenRes.status);
      return;
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string; expires_in: number };

    const sql = postgres(dbUrl, { ssl: "require", max: 1 });
    const now = BigInt(Date.now());
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

    console.log("[sigma] Token refreshed successfully");
  } catch (err: any) {
    console.error("[sigma] Token refresh error:", err?.message ?? err);
  }
}

export default function sigmaTokenRefreshPlugin(nitroApp: any) {
  // Refresh on startup
  refreshSigmaToken();

  // Refresh every 50 minutes to stay ahead of the 60-minute expiry
  const interval = setInterval(refreshSigmaToken, REFRESH_INTERVAL_MS);

  nitroApp.hooks.hookOnce("close", () => {
    clearInterval(interval);
  });
}
