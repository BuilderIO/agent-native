#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import {
  groupAlive,
  listenerPid,
  parseFlags,
  readInstance,
  requireString,
  runDir,
} from "./lib.ts";

const USAGE = `Usage: node .agents/skills/verify-agent-native/scripts/cleanup.ts --run <id>`;

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}
const runId = requireString(flags, "run");
const instance = readInstance(runId);

if (groupAlive(instance.pgid)) {
  process.kill(-instance.pgid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (groupAlive(instance.pgid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (groupAlive(instance.pgid)) process.kill(-instance.pgid, "SIGKILL");
}
await new Promise((r) => setTimeout(r, 500));
const stillListening = listenerPid(instance.port);
if (stillListening !== null) {
  throw new Error(
    `port ${instance.port} still held by pid ${stillListening}; not removing scratch state`,
  );
}

fs.rmSync(instance.scratchDir, { recursive: true, force: true });
const dir = runDir(runId);
fs.renameSync(
  path.join(dir, "instance.json"),
  path.join(dir, "instance.stopped.json"),
);

const evidence = fs.existsSync(instance.evidenceDir)
  ? fs.readdirSync(instance.evidenceDir, { recursive: true }).map(String)
  : [];
console.log(
  JSON.stringify(
    {
      stopped: true,
      port: instance.port,
      scratchRemoved: instance.scratchDir,
      evidenceDir: instance.evidenceDir,
      evidence,
    },
    null,
    2,
  ),
);
