import { useT } from "@agent-native/core/client";
import { IconMovie, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";

type NewCompositionProps = {
  isGenerating?: boolean;
};

export default function NewComposition({ isGenerating }: NewCompositionProps) {
  const t = useT();
  const [storedGenerating, setStoredGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const readStatus = () => {
      setStoredGenerating(
        Boolean(sessionStorage.getItem("videos:new-composition-generating")),
      );
      setError(sessionStorage.getItem("videos:new-composition-error"));
    };
    const clearPending = (message?: string) => {
      sessionStorage.removeItem("videos:new-composition-generating");
      if (message) {
        sessionStorage.setItem("videos:new-composition-error", message);
      }
      readStatus();
    };
    const handleChatRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === false) clearPending();
    };
    const handleRunError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      clearPending(
        typeof detail?.message === "string"
          ? detail.message
          : t("newComposition.runFailed"),
      );
    };
    const handleStorage = () => readStatus();

    readStatus();
    window.addEventListener("videos:new-composition-status", handleStorage);
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    window.addEventListener("agent-chat:run-error", handleRunError);
    const timeout = window.setTimeout(
      () => {
        if (sessionStorage.getItem("videos:new-composition-generating")) {
          clearPending(t("newComposition.timedOut"));
        }
      },
      5 * 60 * 1000,
    );
    return () => {
      window.removeEventListener(
        "videos:new-composition-status",
        handleStorage,
      );
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
      window.removeEventListener("agent-chat:run-error", handleRunError);
      window.clearTimeout(timeout);
    };
  }, []);

  if (isGenerating || storedGenerating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-8 min-w-0 bg-background h-full">
        <div className="flex flex-col items-center gap-4">
          <IconLoader2 size={32} className="text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            {t("newComposition.generating")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-8 min-w-0 bg-background h-full">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center">
          <IconMovie size={24} className="text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground/90">
            {t("newComposition.emptyTitle")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {error ? error : t("newComposition.emptyDescription")}
          </p>
        </div>
      </div>
    </div>
  );
}
