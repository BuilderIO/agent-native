/**
 * Send the monthly recap for a real account using live Clips data.
 *
 * Talks to the database directly with a read-only driver instead of booting
 * the app, so it cannot run a migration against a shared database. Copy is
 * composed exactly as the worker composes it, so this sends the real thing.
 *
 *   npx tsx scripts/send-real-recap.ts --owner a@b.com --to a@b.com --month 2026-07
 */

import postgres from "postgres";

import {
  composeRecapCopy,
  sendClipsTransactionalEmail,
} from "../server/lib/transactional-email-templates.js";

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
    const humanViews = [...humanByClip.values()].reduce((a, b) => a + b, 0);
    const agentSessions = [...agentByClip.values()].reduce((a, b) => a + b, 0);
    if (humanViews === 0 && agentSessions === 0) {
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

    const monthViewerIds = (
      await sql<{ viewer_id: string }[]>`
        select distinct viewer_id from recording_views
         where recording_id = ${top.id}
           and viewed_at >= ${startAt} and viewed_at < ${endAt}`
    ).map((row) => row.viewer_id);
    let completedPct = 0;
    let dropOffMs: number | null = null;
    if (monthViewerIds.length > 0) {
      const [completion] = await sql<{ mean: string | null }[]>`
        select avg(completed_pct) mean from recording_viewers
         where recording_id = ${top.id} and id in ${sql(monthViewerIds)}`;
      completedPct = Math.round(Number(completion?.mean ?? 0));
      const [progress] = await sql<{ timestamp_ms: number }[]>`
        select timestamp_ms from recording_events
         where recording_id = ${top.id} and viewer_id in ${sql(monthViewerIds)}
           and kind in ('watch-progress', 'pause')
           and created_at >= ${startAt} and created_at < ${endAt}
         order by timestamp_ms desc limit 1`;
      dropOffMs = progress ? Number(progress.timestamp_ms) : null;
    }
    const agentBreakdown = (
      await sql<{ agent_label: string | null; n: number }[]>`
        select agent_label, count(*)::int n from recording_agent_views
         where recording_id = ${top.id}
           and first_seen_at >= ${startAt} and first_seen_at < ${endAt}
         group by agent_label order by n desc, agent_label asc`
    ).map((row) => ({
      // "Agent" is the agent-views fallback label, not a product name.
      agentLabel: row.agent_label === "Agent" ? null : row.agent_label,
      sessions: row.n,
    }));

    console.log(
      `Account totals for ${month}: ${humanViews} human views, ${agentSessions} agent sessions`,
    );
    console.log(
      `Top clip: ${top.title} (${humanByClip.get(top.id) ?? 0} human / ${agentByClip.get(top.id) ?? 0} agent)`,
    );

    await sendClipsTransactionalEmail({
      kind: "monthly-recap",
      to,
      month,
      humanViews,
      agentSessions,
      topClip: {
        recordingId: top.id,
        title: top.title,
        thumbnailUrl: top.thumbnail_url,
        durationMs: Number(top.duration_ms),
        recordedAt: top.created_at,
        humanViews: humanByClip.get(top.id) ?? 0,
        agentSessions: agentByClip.get(top.id) ?? 0,
      },
      copy: composeRecapCopy({
        humanViews,
        agentSessions,
        topClip: {
          humanViews: humanByClip.get(top.id) ?? 0,
          completedPct,
          dropOffMs,
          agentBreakdown,
        },
      }),
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
