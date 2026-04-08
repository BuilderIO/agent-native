import { defineAction } from "@agent-native/core";
import { readFileSync, writeFileSync, existsSync } from "fs";

function upsertEnvLine(content: string, key: string, value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid value for ${key}: contains newline or null byte`);
  }

  const regex = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return content.trimEnd() + "\n" + line + "\n";
}

export default defineAction({
  description: "Configure a remote database connection",
  parameters: {
    url: { type: "string", description: "DATABASE_URL (required)" },
    token: {
      type: "string",
      description:
        "DATABASE_AUTH_TOKEN (optional, required for most remote providers)",
    },
  },
  http: false,
  run: async (args) => {
    if (!args.url) {
      throw new Error("url is required (e.g., libsql://your-db.turso.io)");
    }

    const url = args.url;
    const token = args.token || "";

    const maskedUrl = url.replace(/\/\/.*@/, "//***@");

    try {
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url, authToken: token || undefined });
      await client.execute("SELECT 1");
    } catch (err: any) {
      throw new Error(`Connection failed to ${maskedUrl}: ${err.message}`);
    }

    const envPath = ".env";
    let envContent = "";
    if (existsSync(envPath)) {
      envContent = readFileSync(envPath, "utf-8");
    }

    envContent = upsertEnvLine(envContent, "DATABASE_URL", url);
    if (token) {
      envContent = upsertEnvLine(envContent, "DATABASE_AUTH_TOKEN", token);
    }

    writeFileSync(envPath, envContent);

    return `Database connection configured: ${maskedUrl}. Restart the server to apply.`;
  },
});
