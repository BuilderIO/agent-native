import {
  createDbExec,
  getDatabaseUrl,
} from "../packages/core/src/db/client.js";
import { backfillRunHistoryOwnership } from "../packages/core/src/jobs/backfill-run-history-ownership.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "DATABASE_URL=<configured database> pnpm exec tsx scripts/backfill-automation-history-ownership.ts [--dry-run | --apply]\nDefaults to dry-run. Prints counts only. Run manually; never register at startup. Rerun after deploying the history writer fix if old writers are still active.",
  );
} else {
  let db: Awaited<ReturnType<typeof createDbExec>> | undefined;
  try {
    if (
      args.length > 1 ||
      args.some((arg) => !["--dry-run", "--apply"].includes(arg))
    ) {
      throw new Error("Use --dry-run or --apply.");
    }
    const url = getDatabaseUrl();
    if (!/^postgres(?:ql)?:\/\//i.test(url)) {
      throw new Error("An explicit PostgreSQL database is required.");
    }
    db = await createDbExec({ url });
    const counts = await backfillRunHistoryOwnership(db, {
      apply: args.includes("--apply"),
    });
    console.log(
      JSON.stringify({
        mode: args.includes("--apply") ? "apply" : "dry-run",
        ...counts,
      }),
    );
  } catch {
    console.error(
      "History backfill failed; no successful result was confirmed. Database details are suppressed.",
    );
    process.exitCode = 1;
  } finally {
    try {
      await db?.close?.();
    } catch {
      console.error(
        "Database connection cleanup failed. Any result printed above remains committed. Database details are suppressed.",
      );
      process.exitCode = 1;
    }
  }
}
