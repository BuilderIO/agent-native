import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { app } from "electron";

import { forkCommandEnvironment, runForkCommand } from "./client-forks.js";

export async function clientForkToolchain() {
  if (process.platform === "darwin") {
    try {
      await runForkCommand("xcode-select", ["-p"], app.getPath("userData"));
    } catch (error) {
      throw new Error("clientFork.gitRequired", { cause: error });
    }
  }
  try {
    await runForkCommand("git", ["--version"], app.getPath("userData"));
  } catch (error) {
    throw new Error("clientFork.gitRequired", { cause: error });
  }
  const require = createRequire(path.join(app.getAppPath(), "package.json"));
  const manifest = require.resolve("pnpm/package.json");
  const entry = path
    .join(path.dirname(manifest), "bin/pnpm.mjs")
    .replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  await fs.access(entry);
  const bin = path.join(
    app.getPath("userData"),
    "client-forks",
    "toolchain",
    "bin",
  );
  await fs.mkdir(bin, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    await fs.writeFile(
      path.join(bin, "node.cmd"),
      `@"${process.execPath}" %*\r\n`,
    );
  } else {
    const node = path.join(bin, "node");
    try {
      await fs.symlink(process.execPath, node);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
      if ((await fs.readlink(node)) !== process.execPath) {
        await fs.unlink(node);
        await fs.symlink(process.execPath, node);
      }
    }
  }
  return {
    command: process.execPath,
    args: [entry],
    env: {
      ...forkCommandEnvironment(),
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

export async function writeClientForkBuildCommand(
  sourcePath: string,
  appId: string,
  appUrl: string,
  baseSha: string,
): Promise<void> {
  const tools = await clientForkToolchain();
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [tools.command, ...tools.args].map(quote).join(" ");
  const environment = `env ELECTRON_RUN_AS_NODE=1 PATH=${quote(tools.env.PATH)}`;
  const script = [
    "#!/bin/sh",
    "set -eu",
    `cd ${quote(sourcePath)}`,
    `${environment} ${command} --filter @agent-native/toolkit... run build`,
    `cd ${quote(path.join(sourcePath, "templates", appId))}`,
    `${environment} VITE_APP_BASE_PATH=${quote(new URL(appUrl).pathname)} AGENT_NATIVE_BUILD_SHA=${quote(baseSha)} ${command} exec agent-native build --client-only`,
    "",
  ].join("\n");
  await fs.writeFile(
    path.join(sourcePath, ".git", "agent-native-client-build.sh"),
    script,
    { mode: 0o700 },
  );
}
