import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, Repeat2, Eye, MessageCircle } from "lucide-react";
import { DEVREL_TWITTER_USERS, type ParsedTweet } from "./TwitterSection";
import { cn } from "@/lib/utils";

const MEDAL_COLORS = [
  "from-yellow-500/20 to-yellow-600/5 border-yellow-500/30",
  "from-gray-300/20 to-gray-400/5 border-gray-400/30",
  "from-amber-700/20 to-amber-800/5 border-amber-700/30",
];

interface Props {
  tweetsByUser: Record<string, ParsedTweet[]>;
  isLoading: boolean;
  selectedAuthor: string | null;
  onSelectAuthor: (handle: string | null) => void;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface UserStats {
  name: string;
  handle: string;
  tweetCount: number;
  totalLikes: number;
  totalRetweets: number;
  totalReplies: number;
  totalViews: number;
  totalEngagement: number;
  avgLikes: number;
}

export function TwitterLeaderboard({ tweetsByUser, isLoading, selectedAuthor, onSelectAuthor }: Props) {
  const leaderboard = useMemo(() => {
    return DEVREL_TWITTER_USERS.map((u) => {
      const tweets = tweetsByUser[u.handle] ?? [];
      const totalLikes = tweets.reduce((s, t) => s + t.likeCount, 0);
      const totalRetweets = tweets.reduce((s, t) => s + t.retweetCount, 0);
      const totalReplies = tweets.reduce((s, t) => s + t.replyCount, 0);
      const totalViews = tweets.reduce((s, t) => s + t.viewCount, 0);
      const totalEngagement = totalLikes + totalRetweets + totalReplies;
      return {
        name: u.name,
        handle: u.handle,
        tweetCount: tweets.length,
        totalLikes,
        totalRetweets,
        totalReplies,
        totalViews,
        totalEngagement,
        avgLikes: tweets.length ? Math.round(totalLikes / tweets.length) : 0,
      } satisfies UserStats;
    }).sort((a, b) => b.totalEngagement - a.totalEngagement);
  }, [tweetsByUser]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[140px] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {leaderboard.map((user, i) => {
        const isSelected = selectedAuthor === user.handle;
        return (
        <div
          key={user.handle}
          onClick={() => onSelectAuthor(isSelected ? null : user.handle)}
          className={cn(
            "rounded-lg border p-4 space-y-3 cursor-pointer transition-all hover:bg-muted/20 bg-gradient-to-br",
            i < 3 ? MEDAL_COLORS[i] : "from-card to-card border-border/50",
            isSelected && "ring-2 ring-primary"
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground/50">#{i + 1}</span>
                <span className="text-sm font-semibold">{user.name}</span>
              </div>
              <a
                href={`https://x.com/${user.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                @{user.handle}
              </a>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums">{formatCount(user.totalEngagement)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Heart className="h-3 w-3 text-red-400" />
              <span className="tabular-nums">{formatCount(user.totalLikes)}</span>
              <span className="text-muted-foreground">likes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Repeat2 className="h-3 w-3 text-green-400" />
              <span className="tabular-nums">{formatCount(user.totalRetweets)}</span>
              <span className="text-muted-foreground">RTs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MessageCircle className="h-3 w-3 text-blue-400" />
              <span className="tabular-nums">{formatCount(user.totalReplies)}</span>
              <span className="text-muted-foreground">replies</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Eye className="h-3 w-3 text-purple-400" />
              <span className="tabular-nums">{formatCount(user.totalViews)}</span>
              <span className="text-muted-foreground">views</span>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
            {user.tweetCount} tweets &middot; {formatCount(user.avgLikes)} avg likes
          </div>
        </div>
      )})}
    </div>
  );
}
