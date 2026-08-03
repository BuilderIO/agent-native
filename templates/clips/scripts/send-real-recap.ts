/**
 * Send the monthly recap for a real account using live Clips data.
 *
 * Talks to the database directly with a read-only driver instead of booting
 * the app, so it cannot run a migration against a shared database. The four
 * agent-written modules are passed in, mirroring what the AI handoff supplies
 * in production.
 *
 *   npx tsx scripts/send-real-recap.ts --owner a@b.com --to a@b.com \
 *     --month 2026-07 --hero "..." --completion "..." --agents "..." \
 *     --suggestion "..."
 */

import postgres from "postgres";

import { sendClipsTransactionalEmail } from "../server/lib/transactional-email-templates.js";

function arg(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = arg(args, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(args: string[]): Promise<void> {
  const owner = required(args, "owner");
  const to = required(args, "to");
  const month = required(args, "month");
  const databaseUrl = process.env.CLIPS_DATABASE_URL;
  if (!databaseUrl) throw new Error("CLIPS_DATABASE_URL is not set");

  const [year, monthNumber] = month.split("-").map(Number);
  const startAt = new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString();
  const endAt = new Date(Date.UTC(year, monthNumber, 1)).toISOString();

  const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
  try {
    const owned = await sql<
      {
        id: string;
        title: string;
        thumbnail_url: string | null;
        duration_ms: number;
        created_at: string;
      }[]
    >`select id, title, thumbnail_url, duration_ms, created_at
        from recordings where lower(owner_email) = lower(${owner})`;
    if (owned.length === 0) throw new Error(`${owner} owns no recordings`);
    const ids = owned.map((row) => row.id);

    const humans = await sql<{ recording_id: string; n: number }[]>`
      select recording_id,
             count(distinct coalesce(viewer_key, lower(viewer_email), viewer_id))::int n
        from recording_views
       where recording_id in ${sql(ids)}
         and viewed_at >= ${startAt} and viewed_at < ${endAt}
       group by recording_id`;
    const agents = await sql<{ recording_id: string; n: number }[]>`
      select recording_id, count(*)::int n
        from recording_agent_views
       where recording_id in ${sql(ids)}
         and first_seen_at >= ${startAt} and first_seen_at < ${endAt}
       group by recording_id`;

    const humanByClip = new Map(humans.map((row) => [row.recording_id, row.n]));
    const agentByClip = new Map(agents.map((row) => [row.recording_id, row.n]));
    const humanViewers = [...humanByClip.values()].reduce((a, b) => a + b, 0);
    const agentSessions = [...agentByClip.values()].reduce((a, b) => a + b, 0);
    if (humanViewers === 0 && agentSessions === 0) {
      throw new Error(`${owner} had no audience in ${month}; no recap is due`);
    }

    const top = owned
      .filter((row) => humanByClip.has(row.id) || agentByClip.has(row.id))
      .map((row) => ({
        row,
        audience:
          (humanByClip.get(row.id) ?? 0) + (agentByClip.get(row.id) ?? 0),
      }))
      .sort(
        (left, right) =>
          right.audience - left.audience ||
          right.row.created_at.localeCompare(left.row.created_at) ||
          left.row.id.localeCompare(right.row.id),
      )[0].row;

    console.log(
      `Account totals for ${month}: ${humanViewers} human viewers, ${agentSessions} agent sessions`,
    );
    console.log(
      `Top clip: ${top.title} (${humanByClip.get(top.id) ?? 0} human / ${agentByClip.get(top.id) ?? 0} agent)`,
    );

    await sendClipsTransactionalEmail({
      kind: "monthly-recap",
      to,
      month,
      humanViewers,
      agentSessions,
      topClip: {
        recordingId: top.id,
        title: top.title,
        thumbnailUrl: top.thumbnail_url,
        durationMs: Number(top.duration_ms),
        recordedAt: top.created_at,
        humanViewers: humanByClip.get(top.id) ?? 0,
        agentSessions: agentByClip.get(top.id) ?? 0,
      },
      copy: {
        heroLine: required(args, "hero"),
        completionNote: required(args, "completion"),
        agentBreakdown: required(args, "agents"),
        nextClipSuggestion: required(args, "suggestion"),
      },
    });
    console.log(`Sent monthly-recap for ${owner} to ${to}`);
  } finally {
    await sql.end();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
