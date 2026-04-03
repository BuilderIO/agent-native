import { useState } from "react";
import {
  IconShare2,
  IconCopy,
  IconCheck,
  IconLoader2,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import type { Deck } from "@/context/DeckContext";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: Deck;
}

export default function ShareDialog({
  open,
  onOpenChange,
  deck,
}: ShareDialogProps) {
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
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create share link");
      }

      const data = await res.json();
      const url = `${window.location.origin}/share/${data.shareToken}`;
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setShareUrl(null);
          setError("");
        }
      }}
    >
      <DialogContent className="bg-[hsl(240,5%,8%)] border-white/[0.08] max-w-md">
        {showCloudUpgrade || isLocal ? (
          <>
            <DialogTitle className="sr-only">Share Presentation</DialogTitle>
            <DialogDescription className="sr-only">
              Connect a cloud database to share presentations.
            </DialogDescription>
            <CloudUpgrade
              title="Share Presentation"
              description="To share presentations publicly, connect a cloud database so your slides can be accessed from anywhere."
              onClose={() => {
                setShowCloudUpgrade(false);
                onOpenChange(false);
              }}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-white/90 flex items-center gap-2">
                <IconShare2 className="w-5 h-5 text-[#609FF8]" />
                Share Presentation
              </DialogTitle>
              <DialogDescription className="text-white/50">
                Create a shareable link for "{deck.title}". Only this
                presentation will be accessible — no other decks.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {!shareUrl ? (
                <>
                  <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
                    <h4 className="text-sm font-medium text-white/80 mb-2">
                      What gets shared:
                    </h4>
                    <ul className="text-xs text-white/50 space-y-1">
                      <li>
                        - Slide content and layouts ({deck.slides.length}{" "}
                        slides)
                      </li>
                      <li>- Presentation view (fullscreen)</li>
                    </ul>
                    <h4 className="text-sm font-medium text-white/80 mt-3 mb-2">
                      What stays private:
                    </h4>
                    <ul className="text-xs text-white/50 space-y-1">
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
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 outline-none"
                    />
                    <button
                      onClick={handleCopy}
                      className="flex-shrink-0 p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors"
                      title="Copy link"
                      aria-label="Copy link"
                    >
                      {copied ? (
                        <IconCheck className="w-4 h-4 text-green-400" />
                      ) : (
                        <IconCopy className="w-4 h-4 text-white/60" />
                      )}
                    </button>
                  </div>

                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white/70 text-sm transition-colors"
                  >
                    <IconExternalLink className="w-3.5 h-3.5" />
                    Open shared link
                  </a>

                  <p className="text-[11px] text-white/30 text-center">
                    Anyone with this link can view this presentation.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
