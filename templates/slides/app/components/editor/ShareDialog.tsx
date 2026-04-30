import { useState, type ReactNode } from "react";
import {
  IconShare2,
  IconCopy,
  IconCheck,
  IconLoader2,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import type { Deck } from "@/context/DeckContext";
import { appBasePath } from "@agent-native/core/client";

interface ShareDialogProps {
  deck: Deck;
  /** Trigger element rendered as the popover anchor (usually the Share button). */
  children: ReactNode;
}

export default function ShareDialog({ deck, children }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${appBasePath()}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create share link");
      }

      const data = await res.json();
      const url = `${window.location.origin}${appBasePath()}/share/${data.shareToken}`;
      setShareUrl(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setShareUrl(null);
          setError("");
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[420px] bg-card border-border p-4"
      >
        {showCloudUpgrade || isLocal ? (
          <CloudUpgrade
            title="Share Presentation"
            description="To share presentations publicly, connect a cloud database so your slides can be accessed from anywhere."
            onClose={() => {
              setShowCloudUpgrade(false);
              setOpen(false);
            }}
          />
        ) : (
          <>
            <div className="mb-3">
              <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <IconShare2 className="w-4 h-4 text-[#609FF8]" />
                Share Presentation
              </div>
              <div className="text-muted-foreground text-xs mt-0.5">
                Create a shareable link for "{deck.title}". Only this
                presentation will be accessible — no other decks.
              </div>
            </div>

            <div className="space-y-4">
              {!shareUrl ? (
                <>
                  <div className="bg-muted/50 rounded-lg p-3 border border-border">
                    <h4 className="text-sm font-medium text-foreground/90 mb-2">
                      What gets shared:
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>
                        - Slide content and layouts ({deck.slides.length}{" "}
                        slides)
                      </li>
                      <li>- Presentation view (fullscreen)</li>
                    </ul>
                    <h4 className="text-sm font-medium text-foreground/90 mt-3 mb-2">
                      What stays private:
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>- Speaker notes</li>
                      <li>- Other presentations</li>
                      <li>- Editing access</li>
                    </ul>
                  </div>

                  {error && (
                    <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
                      {error}
                    </p>
                  )}

                  <button
                    onClick={handleShare}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#609FF8] hover:bg-[#7AB2FA] disabled:opacity-50 text-black text-sm font-medium transition-colors"
                  >
                    {loading ? (
                      <>
                        <IconLoader2 className="w-4 h-4 animate-spin" />
                        Creating link...
                      </>
                    ) : (
                      <>
                        <IconShare2 className="w-4 h-4" />
                        Create Share Link
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={shareUrl}
                      className="flex-1 bg-accent/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground/90 outline-none"
                    />
                    <button
                      onClick={handleCopy}
                      className="flex-shrink-0 p-2 rounded-lg bg-accent hover:bg-accent border border-border transition-colors"
                      title="Copy link"
                      aria-label="Copy link"
                    >
                      {copied ? (
                        <IconCheck className="w-4 h-4 text-green-400" />
                      ) : (
                        <IconCopy className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-accent hover:bg-accent border border-border text-foreground/70 text-sm transition-colors"
                  >
                    <IconExternalLink className="w-3.5 h-3.5" />
                    Open shared link
                  </a>

                  <p className="text-[11px] text-muted-foreground/70 text-center">
                    Anyone with this link can view this presentation.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
