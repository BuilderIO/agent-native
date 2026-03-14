#!/usr/bin/env tsx
import "dotenv/config";
import { parseArgs, output } from "./helpers";
import { runQuery } from "../server/lib/bigquery";
import { execSync } from "child_process";

// KPMG org IDs (discovered via HubSpot pipeline)
const KPMG_ORG_IDS = [
  "e478af2050e24a02bd140509d0c94df7",
  "e65a38799c2341ae8b8f6b92c5a036e8",
  "6d694b0c3bc34fdaaa54d873b04a800c",
  "2c8cc8c069604e2b9c99048fe13f6563",
  "303f354cdff3432e91d1fab67b3333c9",
  "3e43be3f75054785af59198e846e8744",
  "7d2f15420d6c4fb486150a34135dbe8c",
  "a5e5091652694d17ab50a9c5980bf1b6",
  "9d0c48e5ba2548f0abd1fb6902701d62",
  "d12053e541c84c368564ab719c5309fd",
  "2ffce40b634149c59e27a2663686a4d8",
  "2b00f25a84a4484fb87bb9bc9119d73a",
  "40f6114f205644a3936d05bcc1d69057",
  "f9985e917e9b4fa59c6660395b80ed45",
  "3c89829209f54c1ca9fcec2af83a5f93",
  "3133673725bc4f8a809de457d3c49a22",
  "10608d5331d34409aebac44790b9cf45",
  "89c383033f9640608cc006f745e6fdff",
  "401fb83395954452b557739e6f648148",
  "e8ea972f8e4a4558b8e57525dfa612fb",
  "9e0d3ef0af85481f8b76428f66a912ef",
  "7153cb99400549bb873feb843aca7ba4",
  "118d877179d441e29a6fa39256d71fce",
  "9a92cad737e1437089ede0bf5bddc575",
  "75f866aed95a4b7eb23d63be0b52812b",
  "ba70012eaf564e11bbc765e2523355b4",
  "cc4b6b0574d848fb84a9782147592398",
  "5ac141908cef4ea99ef22d17f54efde4",
  "d50ff5e55de14ac990b411dede14752e",
  "26045ca2c3ec4696a7a95b086d0b4134",
  "cd0196f71a43400ea7a284fba021c859",
  "ac6638d8e52e42dc827714e32b0675f7",
  "3639fc9164694a399d2788775adcd4e6",
  "f293e5f09b134f5886165d05e46aa418",
  "49ec141323574bb482ff2619116952f0",
  "46841b11759c4d96ab4a674b42a6e2c8",
  "9399e4b8ef5c4b45acf40e7e12e6d57c",
  "1af3251d41844b8981573afdedb112f3",
  "73fd522ba9ba419b9af3790a86caa93e",
  "db4d2de99f7d4797baf6a3c566f7d62d",
  "ae6e81118b474974ab3b97308ddbc74c",
  "573d3eb02a344c8ba8d0c905a57726f2",
  "f89d99c79171427da43676e48377556d",
  "b4cfda7456714b8c8b34003e166bc998",
  "b8b0ed2a67d8431d8c2d4394e46b0d82",
  "07dfe20070d04101b570c113383ae93c",
  "7815d6bdfe394a93a29bdbc1e6ee50fc",
  "92fe5b19ecd240ca89b57235cdb17682",
  "d6e5cdf08137413f9099ce95c51ad783",
  "8cd839a040dc471aa836bc261e881af7",
];

const args = parseArgs();
const days = parseInt(args.days || "30", 10);
const orgIdList = KPMG_ORG_IDS.map((id) => `'${id}'`).join(",");

const result = await runQuery(`
  SELECT
    DATE(event_time) as date,
    COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) as email,
    COUNT(*) as message_count
  FROM amplitude.EVENTS_182198
  WHERE event_type = 'fusion chat message submitted'
    AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
    AND event_time <= CURRENT_TIMESTAMP()
    AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList})
    AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@builder.io'
  GROUP BY date, email
  ORDER BY date, message_count DESC
`);

const daily = result.rows as {
  date: string;
  email: string;
  message_count: string;
}[];

// Compute totals per user
const userTotals: Record<string, number> = {};
for (const row of daily) {
  userTotals[row.email] =
    (userTotals[row.email] || 0) + parseInt(row.message_count);
}
const sortedUsers = Object.entries(userTotals).sort((a, b) => b[1] - a[1]);
const top5 = sortedUsers.slice(0, 5).map(([email]) => email);

// Get unique sorted dates
const dates = [...new Set(daily.map((r: any) => r.date as string))].sort();

// Build per-user series
const series: Record<string, number[]> = {};
for (const email of [...top5, "Other"])
  series[email] = new Array(dates.length).fill(0);

for (const row of daily) {
  const idx = dates.indexOf(row.date);
  const bucket = top5.includes(row.email) ? row.email : "Other";
  series[bucket][idx] += parseInt(row.message_count);
}

const colors = [
  "#18B4F4",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#6366f1",
  "#94a3b8",
];
const chartData = Object.entries(series).map(([email, vals], i) => ({
  label: email.replace("@kpmg.com", "").replace("@gmail.com", ""),
  data: vals,
  color: colors[i],
}));

const labels = dates.map((d) => {
  const dt = new Date(d + "T00:00:00");
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
});

// Generate chart
const chartArgs = [
  `--type=bar`,
  `--stacked=true`,
  `--title=KPMG Fusion Messages by User`,
  `--labels=${JSON.stringify(labels)}`,
  `--data=${JSON.stringify(chartData)}`,
  `--filename=kpmg-users-stacked`,
  `--width=900`,
  `--height=450`,
];

const chartResult = execSync(
  `npx tsx scripts/run.ts generate-chart ${chartArgs.map((a) => `'${a}'`).join(" ")}`,
  { cwd: process.cwd(), encoding: "utf8", timeout: 30000 },
);

const chartOutput = JSON.parse(chartResult.trim());

output({
  totalMessages: daily.reduce(
    (sum: number, r: any) => sum + parseInt(r.message_count),
    0,
  ),
  topUsers: sortedUsers.map(([email, count]) => ({
    email,
    total_messages: count,
  })),
  chart: chartOutput,
});
