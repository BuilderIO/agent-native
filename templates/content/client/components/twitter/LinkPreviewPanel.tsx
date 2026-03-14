import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  ExternalLink,
  Plus,
  Check,
} from "lucide-react";
import { useLinkPreview } from "@/hooks/use-twitter";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { TwitterTweet, CollectedLink } from "@shared/api";
import { sendToHarness, onHarnessMessage } from "@agent-native/core/client";

interface LinkPreviewPanelProps {
  url: string;
  tweet?: TwitterTweet;
  onClose: () => void;
  onCollect: (link: CollectedLink) => void;
  isCollected: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

function sendPreviewUrl(url: string) {
  sendToHarness("builder.previewUrl", { url });
}

/** Ask the parent to extract HTML from the webview and return it via message */
function requestWebviewHtml(): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    const cleanup = onHarnessMessage("builder.webviewHtml", (data) => {
      if (data?.requestId === requestId) {
        clearTimeout(timeout);
        cleanup();
        resolve(data.html || null);
      }
    });

    sendToHarness("builder.getWebviewHtml", { requestId });
  });
}

/** Extract metadata from raw HTML string */
function extractMetaFromHtml(html: string, url: string): { title: string; description: string; image?: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const getMeta = (property: string): string | undefined => {
    const el =
      doc.querySelector(`meta[property="${property}"]`) ||
      doc.querySelector(`meta[name="${property}"]`);
    return el?.getAttribute("content") || undefined;
  };

  const title =
    getMeta("og:title") ||
    doc.querySelector("title")?.textContent ||
    url;

  const description =
    getMeta("og:description") ||
    getMeta("description") ||
    "";

  const image = getMeta("og:image");

  return { title, description, image };
}

export function LinkPreviewPanel({
  url,
  tweet,
  onClose,
  onCollect,
  isCollected,
}: LinkPreviewPanelProps) {
  const { data: preview } = useLinkPreview(url);
  const [collecting, setCollecting] = useState(false);

  const resolvedUrl = preview?.url || url;
  const resolvedDomain = preview?.domain || getDomain(resolvedUrl);

  // Send preview URL to parent on mount and when URL changes
  const lastSentUrl = useRef<string | null>(null);
  useEffect(() => {
    if (resolvedUrl && resolvedUrl !== lastSentUrl.current) {
      lastSentUrl.current = resolvedUrl;
      sendPreviewUrl(resolvedUrl);
    }
  }, [resolvedUrl]);

  // Close preview in parent on unmount
  useEffect(() => {
    return () => {
      sendPreviewUrl("");
    };
  }, []);

  // Listen for parent closing the preview overlay (dispatched as CustomEvent)
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("builder.previewUrlClosed", handler);
    return () => window.removeEventListener("builder.previewUrlClosed", handler);
  }, [onClose]);

  const handleClose = useCallback(() => {
    sendPreviewUrl("");
    onClose();
  }, [onClose]);

  const handleCollect = async () => {
    if (isCollected || collecting) return;
    setCollecting(true);
    try {
      // Try to get HTML directly from the webview for accurate metadata
      const html = await requestWebviewHtml();
      if (html) {
        console.log("[LinkPreviewPanel] Webview HTML received:", html);
      } else {
        console.log("[LinkPreviewPanel] No webview HTML returned, falling back to backend preview");
      }
      const meta = html
        ? extractMetaFromHtml(html, resolvedUrl)
        : {
            title: preview?.title || resolvedUrl,
            description: preview?.description || "",
            image: preview?.image,
          };

      onCollect({
        url: resolvedUrl,
        title: meta.title,
        description: meta.description,
        domain: resolvedDomain,
        image: meta.image,
        tweetId: tweet?.id || "",
        tweetAuthor: tweet ? `@${tweet.author.userName}` : "",
        tweetText: tweet?.text?.slice(0, 200) || "",
        html: html || undefined,
      });
    } finally {
      setCollecting(false);
    }
  };

  return (
    <>
      {/* Floating toolbar — sits between main content and the spacer in the flex row */}
      <div className="shrink-0 flex items-center py-4">
        <div className="flex items-center">
          {/* Toolbar pill */}
          <div className="flex flex-col items-center gap-1 bg-popover border border-border rounded-lg shadow-lg p-1.5">
            {/* Collect — primary at top */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCollect}
                  disabled={isCollected}
                  className={`p-1.5 rounded-md transition-colors ${
                    isCollected
                      ? "text-primary bg-primary/10"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  } disabled:cursor-not-allowed`}
                >
                  {isCollected ? <Check size={15} /> : <Plus size={15} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {isCollected ? "Already collected" : "Collect link"}
              </TooltipContent>
            </Tooltip>

            <ToolbarDivider />

            {/* Open external */}
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={resolvedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink size={15} />
                </a>
              </TooltipTrigger>
              <TooltipContent side="left">Open in new tab</TooltipContent>
            </Tooltip>

            <ToolbarDivider />

            {/* Close — at bottom */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X size={15} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Close preview</TooltipContent>
            </Tooltip>
          </div>

          {/* Right-pointing arrow */}
          <div className="w-2 flex items-center">
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderLeft: "6px solid hsl(var(--border))",
              }}
            />
          </div>
        </div>
      </div>

      {/* Empty 50vw spacer — parent renders webview overlay on top of this */}
      <div className="shrink-0" style={{ width: "50vw" }} />
    </>
  );
}

function ToolbarDivider() {
  return <div className="w-5 h-px bg-border my-0.5" />;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
