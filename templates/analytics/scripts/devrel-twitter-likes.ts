#!/usr/bin/env tsx
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
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - days);

const results = [];

for (const user of DEVREL_USERS) {
  const tweets = (await fetchAllTweetsForUser(apiKey, user.handle, 5)) as any[];

  const recentTweets = tweets.filter((t) => {
    if (!t.createdAt) return false;
    if (t.text?.startsWith("RT @")) return false;
    return new Date(t.createdAt) >= cutoff;
  });

  const totalLikes = recentTweets.reduce(
    (sum, t) => sum + (t.likeCount ?? 0),
    0,
  );
  const totalRetweets = recentTweets.reduce(
    (sum, t) => sum + (t.retweetCount ?? 0),
    0,
  );
  const totalViews = recentTweets.reduce(
    (sum, t) => sum + (t.viewCount ?? 0),
    0,
  );
  const totalReplies = recentTweets.reduce(
    (sum, t) => sum + (t.replyCount ?? 0),
    0,
  );

  const topTweets = recentTweets
    .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
    .slice(0, 3)
    .map((t) => ({
      text: t.text?.slice(0, 120),
      likes: t.likeCount,
      views: t.viewCount,
      url: t.url,
    }));

  results.push({
    name: user.name,
    handle: user.handle,
    tweetCount: recentTweets.length,
    totalLikes,
    totalRetweets,
    totalViews,
    totalReplies,
    topTweets,
  });
}

results.sort((a, b) => b.totalLikes - a.totalLikes);

output({
  period: `Last ${days} days (since ${cutoff.toISOString().split("T")[0]})`,
  leaderboard: results,
});
