import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const clientModule = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "client.ts"),
).href;
const childSource = `
  import fs from "node:fs";
  import path from "node:path";
  import { setTimeout as sleep } from "node:timers/promises";
  const dir = process.env.PGLITE_LOCK_DIR;
  const marker = (name) => path.join(dir, name);
  const { closePgliteClients, getPgliteClient } = await import(${JSON.stringify(clientModule)});
  try {
    if (process.env.PGLITE_LOCK_MODE === "owner") {
      const client = await getPgliteClient("pglite:" + path.join(dir, "db"));
      await client.exec("CREATE TABLE probe_rows (id integer primary key, who text not null)");
      await client.exec("INSERT INTO probe_rows (id, who) VALUES (1, CHR(65))");
      fs.writeFileSync(marker("owner-ready"), "ready");
      while (!fs.existsSync(marker("competitor-done"))) await sleep(25);
      await closePgliteClients();
      fs.writeFileSync(marker("owner-closed"), "closed");
    } else if (process.env.PGLITE_LOCK_MODE === "competitor") {
      try {
        await getPgliteClient("pglite:" + path.join(dir, "db"));
        fs.writeFileSync(marker("competitor-opened"), "opened");
      } catch (error) {
        fs.writeFileSync(marker("competitor-error"), error instanceof Error ? error.message : String(error));
      }
    } else {
      const client = await getPgliteClient("pglite:" + path.join(dir, "db"));
      const result = await client.query("SELECT id, who FROM probe_rows ORDER BY id");
      console.log(JSON.stringify(result.rows));
      await closePgliteClients();
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
`;

function spawnChild(dir: string, mode: string, stdout: "ignore" | "pipe") {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", childSource],
    {
      cwd: repoRoot,
      env: { ...process.env, PGLITE_LOCK_DIR: dir, PGLITE_LOCK_MODE: mode },
      stdio: ["ignore", stdout, "inherit"],
    },
  );
  const exited = new Promise<number>((resolve, reject) =>
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(0);
      else reject(new Error(`${mode} exited with ${code ?? signal}`));
    }),
  );
  return { child, exited };
}

async function waitFor(pathname: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (existsSync(pathname)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${pathname}`);
}

describe("PGlite persistent process ownership", () => {
  it("rejects a competing process without losing the owner's write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pglite-process-lock-"));
    const dbDir = path.join(dir, "db");
    try {
      const owner = spawnChild(dir, "owner", "ignore");
      await waitFor(path.join(dir, "owner-ready"));

      const competitor = spawnChild(dir, "competitor", "ignore");
      await competitor.exited;
      expect(existsSync(path.join(dir, "competitor-error"))).toBe(true);
      expect(readFileSync(path.join(dir, "competitor-error"), "utf8")).toMatch(
        /already owned by process/,
      );

      writeFileSync(path.join(dir, "competitor-done"), "done");
      await waitFor(path.join(dir, "owner-closed"));
      await owner.exited;

      const reader = spawnChild(dir, "reader", "pipe");
      let output = "";
      reader.child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      await reader.exited;

      expect(output.trim()).toBe('[{"id":1,"who":"A"}]');
      expect(existsSync(`${dbDir}.agent-native-pglite.lock`)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
