import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconShare2,
  IconCopy,
  IconCheck,
  IconLoader2,
  IconExternalLink,
  IconChevronDown,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { CloudUpgrade } from "@/components/CloudUpgrade";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Deck } from "@/context/DeckContext";
import { useDbStatus } from "@/hooks/use-db-status";

interface ShareDialogProps {
  deck: Deck;
  /** Trigger element rendered as the popover anchor (usually the Share button). */
  children: ReactNode;
}

export default function ShareDialog({ deck, children }: ShareDialogProps) {
  const t = useT();
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
        throw new Error(err.error || t("share.createFailed"));
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
        className="w-[min(420px,calc(100vw-2rem))] bg-card border-border p-4"
      >
        {showCloudUpgrade || isLocal ? (
          <CloudUpgrade
            title={t("share.title")}
            description={t("share.cloudUpgradeDescription")}
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
                {t("share.title")}
              </div>
            </div>

            <div className="space-y-4">
              {!shareUrl ? (
                <>
                  <details className="group rounded-md border border-border bg-muted/30">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                      {t("share.whatGetsShared")}
                      <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-3 border-t border-border px-3 py-3 text-xs text-muted-foreground">
                      <ul className="space-y-1">
                        <li>
                          {t("share.slideContent", {
                            count: deck.slides.length,
                          })}
                        </li>
                        <li>{t("share.presentationView")}</li>
                      </ul>
                      <div>
                        <h4 className="mb-1 font-medium text-foreground/90">
                          {t("share.whatStaysPrivate")}
                        </h4>
                        <ul className="space-y-1">
                          <li>{t("share.speakerNotes")}</li>
                          <li>{t("share.otherPresentations")}</li>
                          <li>{t("share.editingAccess")}</li>
                        </ul>
                      </div>
                    </div>
                  </details>

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
                        {t("share.creatingLink")}
                      </>
                    ) : (
                      <>
                        <IconShare2 className="w-4 h-4" />
                        {t("share.createShareLink")}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleCopy}
                          className="flex-shrink-0 p-2 rounded-lg bg-accent hover:bg-accent border border-border transition-colors"
                          aria-label={t("share.copyLink")}
                        >
                          {copied ? (
                            <IconCheck className="w-4 h-4 text-green-400" />
                          ) : (
                            <IconCopy className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("share.copyLink")}</TooltipContent>
                    </Tooltip>
                  </div>

                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-accent hover:bg-accent border border-border text-foreground/70 text-sm transition-colors"
                  >
                    <IconExternalLink className="w-3.5 h-3.5" />
                    {t("share.openSharedLink")}
                  </a>

                  <p className="sr-only text-[11px] text-muted-foreground/70 text-center">
                    {t("share.anyoneWithLink")}
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
