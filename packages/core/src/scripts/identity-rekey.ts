import { pathToFileURL } from "node:url";

import { getDatabaseUrl } from "../db/client.js";
import {
  executeIdentityRekey,
  listPendingIdentityRekeys,
  resumePendingIdentityRekeys,
  type IdentityRekeyDb,
} from "../identity/rekey.js";
import {
  createPostgresScriptClient,
  type PostgresScriptClient,
} from "./db/postgres-client.js";

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const equals = arg.indexOf("=");
    if (equals >= 0) parsed[arg.slice(2, equals)] = arg.slice(equals + 1);
    else if (args[index + 1] && !args[index + 1].startsWith("--")) {
      parsed[arg.slice(2)] = args[++index];
    } else parsed[arg.slice(2)] = "true";
  }
  return parsed;
}

function usage(): void {
  console.log(`Usage: agent-native identity rekey --from <old-email> --to <new-email> [--yes]
       agent-native identity rekey --resume

Without --yes, validates the rekey and prints the affected row counts.
With --yes, applies it transactionally to this app's database and revokes sessions.
Use --already-updated only to repair references after Better Auth already changed the account email.
Use --resume to retry pending email changes left by a committed Better Auth update.
Run once per app in a multi-app workspace.`);
}

function identityRekeyDb(client: PostgresScriptClient): IdentityRekeyDb {
  const db: IdentityRekeyDb = {
    unsafe: (sql, args) => client.unsafe(sql, args),
    transaction: (fn) => client.begin((tx) => fn(identityRekeyDb(tx))),
  };
  return db;
}

export default async function identityRekey(args: string[]): Promise<void> {
  if (args.includes("--help")) return usage();
  const parsed = parseArgs(args);
  if (parsed.resume === "true" && (parsed.from || parsed.to)) return usage();
  if (parsed.resume !== "true" && (!parsed.from || !parsed.to)) return usage();
  const apply = parsed.resume === "true" || parsed.yes === "true";
  if (parsed["identity-declarations"])
    await import(pathToFileURL(parsed["identity-declarations"]).href);
  const client = await createPostgresScriptClient(
    getDatabaseUrl("pglite:./data/pglite"),
  );
  try {
    const db = identityRekeyDb(client);
    if (parsed.resume === "true") {
      const pending = await listPendingIdentityRekeys(db);
      if (pending.length === 0) {
        console.log("No pending identity rekeys.");
        return;
      }
      for (const row of pending) {
        await resumePendingIdentityRekeys(db, row.newEmail);
        console.log(`Resumed ${row.oldEmail} -> ${row.newEmail}`);
      }
      return;
    }

    const result = await executeIdentityRekey(db, parsed.from!, parsed.to!, {
      dryRun: !apply,
      actorEmail: process.env.AGENT_USER_EMAIL ?? null,
      accountAlreadyUpdated: parsed["already-updated"] === "true",
      caller: "cli",
    });
    console.log(
      `${apply ? "Applied" : "Validated only"} in this app database:`,
    );
    for (const [surface, count] of Object.entries(result.counts)) {
      console.log(`  ${surface}: ${count}`);
    }
    console.log(
      `  sessions revoked: ${apply ? result.sessionCount : `${result.sessionCount} (on apply)`}`,
    );
    if (result.oauthRevokedCount)
      console.log(`  OAuth credentials revoked: ${result.oauthRevokedCount}`);
    if (!apply) console.log("No data changed. Re-run with --yes to apply.");
  } finally {
    await client.end();
  }
}

void identityRekey(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
