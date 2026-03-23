import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Heart, Repeat2, Eye, MessageCircle } from "lucide-react";
import { getIdToken } from "@/lib/auth";
import { TwitterLeaderboard } from "./TwitterLeaderboard";
import { TwitterTopPosts } from "./TwitterTopPosts";

export const DEVREL_TWITTER_USERS: { name: string; handle: string }[] = [
  { name: "Steve", handle: "Steve8708" },
  { name: "Alice", handle: "tempoimmaterial" },
  { name: "Vishwas", handle: "CodevolutionWeb" },
  { name: "Matt", handle: "zuchka_" },
];

export interface ParsedTweet {
  id: string;
  text: string;
  url: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  createdAt: string;
  isReply: boolean;
  authorHandle: string;
  authorName: string;
  cardTitle?: string;
  cardUrl?: string;
}

async function fetchMultiUserTweets(): Promise<Record<string, ParsedTweet[]>> {
  const token = await getIdToken();
  const handles = DEVREL_TWITTER_USERS.map((u) => u.handle).join(",");
  const resp = await fetch(
    `/api/twitter/multi?userNames=${encodeURIComponent(handles)}&pages=5`,
    {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    },
  );
  if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
  const data = await resp.json();
  const result: Record<string, ParsedTweet[]> = {};
  for (const user of DEVREL_TWITTER_USERS) {
    const raw = (data.users?.[user.handle] ?? []) as any[];
    result[user.handle] = raw.map((t) => {
      // Extract card/link metadata if available
      const cardTitle =
        t.card?.title || t.entities?.urls?.[0]?.title || t.title;
      const cardUrl =
        t.card?.url ||
        t.entities?.urls?.[0]?.expanded_url ||
        t.entities?.urls?.[0]?.url;

      return {
        id: t.id,
        text: t.text ?? "",
        url: t.url ?? "",
        likeCount: t.likeCount ?? 0,
        retweetCount: t.retweetCount ?? 0,
        replyCount: t.replyCount ?? 0,
        quoteCount: t.quoteCount ?? 0,
        viewCount: t.viewCount ?? 0,
        bookmarkCount: t.bookmarkCount ?? 0,
        createdAt: t.createdAt ?? "",
        isReply: t.isReply ?? false,
        authorHandle: user.handle,
        authorName: user.name,
        cardTitle,
        cardUrl,
      };
    });
  }
  return result;
}

interface TwitterSectionProps {
  days: number;
}

export function TwitterSection({ days }: TwitterSectionProps) {
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["devrel-twitter-multi"],
    queryFn: fetchMultiUserTweets,
    staleTime: 10 * 60 * 1000,
  });

  // Filter tweets to only those within the last N days, exclude retweets (text starts with "RT @")
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }, [days]);

  const filteredByUser = useMemo(() => {
    if (!data) return {};
    const result: Record<string, ParsedTweet[]> = {};
    for (const [handle, tweets] of Object.entries(data)) {
      result[handle] = tweets.filter((t) => {
        if (t.text.startsWith("RT @")) return false;
        if (!t.createdAt) return true;
        return new Date(t.createdAt) >= cutoff;
      });
    }
    return result;
  }, [data, cutoff]);

  // All filtered tweets for top posts table
  const allTweets = useMemo(() => {
    const all = Object.values(filteredByUser).flat();
    if (!selectedAuthor) return all;
    return all.filter((t) => t.authorHandle === selectedAuthor);
  }, [filteredByUser, selectedAuthor]);

  if (error) {
    return (
      <Card className="bg-muted/30 border-border/50">
        <CardContent className="py-4">
          <p className="text-sm text-red-400 text-center">{String(error)}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-t border-border pt-3 mt-2">
        <h2 className="text-sm font-semibold">
          Twitter Engagement (Last {days} Days)
        </h2>
      </div>
      <TwitterLeaderboard
        tweetsByUser={filteredByUser}
        isLoading={isLoading}
        selectedAuthor={selectedAuthor}
        onSelectAuthor={setSelectedAuthor}
      />
      <TwitterTopPosts
        tweets={allTweets}
        isLoading={isLoading}
        selectedAuthor={selectedAuthor}
        onClearFilter={() => setSelectedAuthor(null)}
      />
    </div>
  );
}
