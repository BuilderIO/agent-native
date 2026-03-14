import {
  Heart,
  MessageCircle,
  Repeat2,
  Eye,
  Bookmark,
  ExternalLink,
  BadgeCheck,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TwitterTweet } from "@shared/api";

interface TweetCardProps {
  tweet: TwitterTweet;
  onLinkClick?: (url: string, tweet: TwitterTweet) => void;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m`;
  if (diffH < 24) return `${Math.floor(diffH)}h`;
  if (diffH < 24 * 7) return `${Math.floor(diffH / 24)}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function isTwitterVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // Twitter/X video URLs
    if ((host === "twitter.com" || host === "x.com") && /\/video\//.test(u.pathname)) return true;
    // Direct video file extensions
    if (/\.(mp4|webm|mov|avi|m3u8)(\?|$)/i.test(u.pathname)) return true;
  } catch {}
  return false;
}

function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/\S+/g) || [];
  return matches.filter((url) => !isTwitterVideoUrl(url));
}

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

export function TweetCard({ tweet, onLinkClick }: TweetCardProps) {
  // Filter out links when the tweet has video media (t.co links to the video itself)
  const hasVideo = tweet.media?.some((m) => m.type === "video" || m.type === "animated_gif");
  const rawLinks = extractLinks(tweet.text);
  const links = hasVideo
    ? rawLinks.filter((url) => {
        try {
          const host = new URL(url).hostname;
          // t.co links on video tweets are usually the video itself
          return host !== "t.co";
        } catch { return true; }
      })
    : rawLinks;

  function renderTweetText(text: string) {
    const parts = text.split(/(https?:\/\/\S+|@\w+|#\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith("http")) {
        if (onLinkClick) {
          return (
            <button
              key={i}
              className="text-blue-500 hover:underline break-all text-left"
              onClick={(e) => {
                e.stopPropagation();
                onLinkClick(part, tweet);
              }}
            >
              {getDomain(part)}
            </button>
          );
        }
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {getDomain(part)}
          </a>
        );
      }
      if (part.startsWith("@") || part.startsWith("#")) {
        return (
          <span key={i} className="text-blue-500">
            {part}
          </span>
        );
      }
      return part;
    });
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground transition-all hover:shadow-md">
      {/* Header */}
      <div className="flex items-start gap-2.5 p-3 pb-0">
        <img
          src={tweet.author.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(tweet.author.name)}&size=40&background=1d9bf0&color=fff`}
          alt={tweet.author.name}
          className="w-9 h-9 rounded-full shrink-0 object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(tweet.author.name)}&size=40&background=1d9bf0&color=fff`;
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-sm font-semibold truncate">{tweet.author.name}</span>
            {tweet.author.isBlueVerified && (
              <BadgeCheck size={14} className="text-blue-500 shrink-0" />
            )}
            <span className="text-xs text-muted-foreground truncate">
              @{tweet.author.userName}
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(tweet.createdAt)}
            </span>
          </div>
          {tweet.author.followers != null && tweet.author.followers > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {formatCount(tweet.author.followers)} followers
            </span>
          )}
        </div>
        <a
          href={tweet.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          title="Open on X"
        >
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Tweet text */}
      <div className="px-3 pt-2 text-sm leading-relaxed whitespace-pre-wrap">
        {renderTweetText(tweet.text)}
      </div>

      {/* Media */}
      {tweet.media && tweet.media.length > 0 && (
        <div className={cn(
          "mx-3 mt-2 rounded-lg overflow-hidden",
          tweet.media.length > 1 && "grid grid-cols-2 gap-0.5"
        )}>
          {tweet.media.slice(0, 4).map((m, i) => (
            <img
              key={i}
              src={m.url || m.thumbnailUrl}
              alt=""
              className={cn(
                "w-full object-cover bg-muted",
                tweet.media!.length === 1 ? "max-h-72 rounded-lg" : "h-32"
              )}
              loading="lazy"
            />
          ))}
        </div>
      )}

      {/* Link chips - clickable for preview */}
      {links.length > 0 && (
        <div className="px-3 pt-2 space-y-1.5">
          {links.slice(0, 2).map((url, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                if (onLinkClick) {
                  onLinkClick(url, tweet);
                } else {
                  window.open(url, "_blank", "noopener,noreferrer");
                }
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors group text-left"
            >
              <Link2 size={12} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground group-hover:text-foreground truncate">
                {getDomain(url)}
              </span>
              <ExternalLink size={10} className="text-muted-foreground/50 shrink-0 ml-auto" />
            </button>
          ))}
        </div>
      )}

      {/* Engagement */}
      <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground whitespace-nowrap">
        <Stat icon={MessageCircle} value={tweet.replyCount} />
        <Stat icon={Repeat2} value={tweet.retweetCount} />
        <Stat icon={Heart} value={tweet.likeCount} />
        <Stat icon={Eye} value={tweet.viewCount} />
        <Stat icon={Bookmark} value={tweet.bookmarkCount} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, value }: { icon: any; value: number }) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <Icon size={12} />
      {formatCount(value)}
    </span>
  );
}
