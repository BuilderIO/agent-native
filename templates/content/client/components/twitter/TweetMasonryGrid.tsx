import type { TwitterTweet } from "@shared/api";
import { TweetCard } from "./TweetCard";

interface TweetMasonryGridProps {
  tweets: TwitterTweet[];
  onLinkClick?: (url: string, tweet: TwitterTweet) => void;
}

export function TweetMasonryGrid({ tweets, onLinkClick }: TweetMasonryGridProps) {
  if (!tweets.length) return null;

  // Round-robin distribute tweets across columns to preserve sort order visually
  const cols: TwitterTweet[][] = [[], []];
  tweets.forEach((tweet, i) => {
    cols[i % 2].push(tweet);
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
      {cols.map((col, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-3">
          {col.map((tweet) => (
            <TweetCard key={tweet.id} tweet={tweet} onLinkClick={onLinkClick} />
          ))}
        </div>
      ))}
    </div>
  );
}
