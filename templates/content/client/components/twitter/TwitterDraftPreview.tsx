import { useState } from "react";
import { BadgeCheck, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TwitterDraftPreviewProps {
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
}

export function TwitterDraftPreview({
  authorName = "Your Name",
  authorHandle = "yourhandle",
  authorAvatar,
}: TwitterDraftPreviewProps) {
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);

  const charCount = text.length;
  const isOverLimit = charCount > 280;

  return (
    <div className="space-y-4">
      {/* Composer */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Compose your tweet
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's happening?"
          rows={4}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              onClick={() => setShowImageInput(!showImageInput)}
            >
              <ImagePlus size={14} />
            </Button>
          </div>
          <span
            className={`text-xs ${isOverLimit ? "text-red-500 font-medium" : "text-muted-foreground"}`}
          >
            {charCount}/280
          </span>
        </div>
        {showImageInput && (
          <div className="flex items-center gap-2">
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Paste image URL..."
              className="h-7 text-xs"
            />
            {imageUrl && (
              <button
                onClick={() => {
                  setImageUrl("");
                  setShowImageInput(false);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Live Preview */}
      {text && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">
            Preview
          </label>
          <div className="rounded-xl border bg-card p-4 max-w-lg">
            <div className="flex items-start gap-2.5">
              <img
                src={
                  authorAvatar ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&size=48&background=1d9bf0&color=fff`
                }
                alt={authorName}
                className="w-10 h-10 rounded-full shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold">{authorName}</span>
                  <BadgeCheck size={14} className="text-blue-500" />
                  <span className="text-xs text-muted-foreground">
                    @{authorHandle} · just now
                  </span>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap leading-relaxed">
                  {text}
                </p>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="mt-2 rounded-xl max-h-64 w-full object-cover border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="flex items-center gap-6 mt-3 text-muted-foreground text-xs">
                  <span>0 replies</span>
                  <span>0 retweets</span>
                  <span>0 likes</span>
                  <span>0 views</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
