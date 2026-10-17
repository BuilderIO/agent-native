#!/usr/bin/env node
import {
  CDP_URL,
  GATEWAY_URL,
  groupAlive,
  listenerDb,
  listenerPid,
  parseFlags,
  processGroup,
  readInstance,
} from "./lib.ts";

const USAGE = `Usage:
  node .agents/skills/verify-agent-native/scripts/doctor.ts --run <id>
  node .agents/skills/verify-agent-native/scripts/doctor.ts --gateway --app <template>`;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help || (!flags.run && !flags.gateway)) {
  console.log(USAGE);
  process.exit(flags.help ? 0 : 2);
}

const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

async function httpStatus(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return String(res.status);
  } catch (error) {
    return `unreachable: ${(error as Error).message}`;
  }
}

try {
  const res = await fetch(`${CDP_URL}/json/version`);
  const body = (await res.json()) as { Browser?: string };
  add("cdp", res.ok, `${CDP_URL} ${body.Browser ?? "unknown browser"}`);
} catch (error) {
  add("cdp", false, `${CDP_URL} unreachable: ${(error as Error).message}`);
}

let instance: ReturnType<typeof readInstance> | null = null;
if (typeof flags.run === "string") {
  try {
    instance = readInstance(flags.run);
  } catch (error) {
    add("instance", false, (error as Error).message);
  }
}

if (instance) {
  const alive = groupAlive(instance.pgid);
  add("process", alive, `pgid ${instance.pgid} ${alive ? "alive" : "gone"}`);
  const pid = listenerPid(instance.port);
  const ownedPgid = pid === null ? null : processGroup(pid);
  add(
    "port-owner",
    ownedPgid === instance.pgid,
    pid === null
      ? `nothing listening on ${instance.port}`
      : `pid ${pid} (pgid ${ownedPgid}) on ${instance.port}`,
  );
  if (pid !== null) {
    const db = listenerDb(pid, instance.app);
    add(
      "scratch-db",
      db.kind === "pglite" && `pglite:${db.location}` === instance.dbUrl,
      JSON.stringify(db),
    );
  }
  const status = await httpStatus(`${instance.url}/`);
  add("http", /^[234]/.test(status), `${instance.url}/ -> ${status}`);
} else if (flags.gateway) {
  const app = typeof flags.app === "string" ? flags.app : null;
  if (!app) throw new Error("--gateway requires --app <template>");
  let entry:
    | { id: string; port: number; running: boolean; url: string }
    | undefined;
  try {
    const res = await fetch(`${GATEWAY_URL}/_workspace/apps`);
    const apps = (await res.json()) as Array<{
      id: string;
      port: number;
      running: boolean;
      url: string;
    }>;
    entry = apps.find((a) => a.id === app);
    add(
      "gateway",
      entry !== undefined,
      entry
        ? `${entry.url} port ${entry.port} running=${entry.running}`
        : `${app} not exposed by ${GATEWAY_URL}; restart dev-lazy with --apps ${app}`,
    );
  } catch (error) {
    add(
      "gateway",
      false,
      `${GATEWAY_URL} unreachable: ${(error as Error).message}`,
    );
  }
  if (entry?.running) {
    const pid = listenerPid(entry.port);
    if (pid !== null) {
      const db = listenerDb(pid, app);
      add(
        "db",
        true,
        db.kind === "remote"
          ? `REMOTE ${db.host}: shared data, read-only proofs only`
          : JSON.stringify(db),
      );
    }
  }
}

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
