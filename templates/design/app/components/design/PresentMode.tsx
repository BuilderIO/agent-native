import { useEffect, useCallback, useRef } from "react";

interface PresentModeProps {
  content: string;
  onExit: () => void;
}

export function PresentMode({ content, onExit }: PresentModeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    },
    [onExit],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Enter fullscreen on mount
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {
      // Fullscreen may not be available; continue in windowed mode
    });

    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  // Listen for fullscreen exit to trigger onExit
  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        onExit();
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [onExit]);

  const srcdoc = content.includes("</body>")
    ? content
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style></head><body>${content}</body></html>`;

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0"
        title="Present Mode"
      />
    </div>
  );
}
