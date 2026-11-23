import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

export async function cleanupLocalStagedDataset(options: {
  datasetId: string;
  databaseUrl: string | undefined;
  email: string;
  workspaceId: string;
}) {
  const database = new URL(options.databaseUrl ?? "http://invalid");
  if (
    database.protocol !== "postgresql:" ||
    database.hostname !== "127.0.0.1" ||
    !database.port ||
    database.username !== "qa_analytics2" ||
    database.password ||
    database.pathname !== "/qa_analytics2" ||
    database.search ||
    database.hash ||
    options.email !== "qa-fleet@builder.io" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(options.datasetId) ||
    !options.workspaceId
  )
    throw new Error(
      "Staged cleanup requires the isolated QA database and account",
    );
  const cleanupConfig = await mkdtemp(resolve(".tmp/analytics-cleanup-"));
  try {
    const args = [
      "--filter",
      "analytics-2",
      "action",
      "delete-staged-dataset",
      "--datasetId",
      options.datasetId,
      "--approved",
    ];
    const child = spawn("pnpm", args, {
      shell: process.platform === "win32",
      stdio: "ignore",
      timeout: 30000,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: cleanupConfig,
        DATABASE_URL: options.databaseUrl,
        DATABASE_URL_UNPOOLED: "",
        NETLIFY_DATABASE_URL: "",
        NETLIFY_DATABASE_URL_UNPOOLED: "",
        AGENT_USER_EMAIL: options.email,
        AGENT_ORG_ID: options.workspaceId,
        AGENT_ORG_SCOPE: "org",
      },
    });
    const code = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (value, signal) => done(signal ? 1 : (value ?? 1)));
    });
    if (code !== 0) throw new Error(`Staged cleanup action exited ${code}`);
  } finally {
    await rm(cleanupConfig, { recursive: true, force: true });
  }
}
