#!/usr/bin/env tsx
import "dotenv/config";
import { parseArgs, output, fatal } from "./helpers";
import { fetchAllTweetsForUser } from "../server/handlers/twitter";

const DEVREL_USERS = [
  { name: "Steve", handle: "Steve8708" },
  { name: "Alice", handle: "tempoimmaterial" },
  { name: "Vishwas", handle: "CodevolutionWeb" },
  { name: "Matt", handle: "zuchka_" },
];

const apiKey = process.env.TWITTER_API_KEY;
if (!apiKey) fatal("TWITTER_API_KEY environment variable not configured");

const args = parseArgs();
const days = Number(args.days) || 30;
const pages = Number(args.pages) || 3;
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - days);

const results: {
  name: string;
  handle: string;
  tweets: number;
  totalLikes: number;
  totalViews: number;
  topTweetUrl?: string;
  topTweetLikes?: number;
}[] = [];

for (const user of DEVREL_USERS) {
  const tweets = (await fetchAllTweetsForUser(
    apiKey,
    user.handle,
    pages,
  )) as any[];
  const recent = tweets.filter(
    (t) =>
      t.createdAt &&
      !t.text?.startsWith("RT @") &&
      new Date(t.createdAt) >= cutoff,
  );
  const totalLikes = recent.reduce(
    (s: number, t: any) => s + (t.likeCount ?? 0),
    0,
  );
  const totalViews = recent.reduce(
    (s: number, t: any) => s + (t.viewCount ?? 0),
    0,
  );
  const sorted = recent.sort(
    (a: any, b: any) => (b.likeCount ?? 0) - (a.likeCount ?? 0),
  );
  results.push({
    name: user.name,
    handle: user.handle,
    tweets: recent.length,
    totalLikes,
    totalViews,
    topTweetUrl: sorted[0]?.url,
    topTweetLikes: sorted[0]?.likeCount,
  });
}

results.sort((a, b) => b.totalLikes - a.totalLikes);
output(results);
