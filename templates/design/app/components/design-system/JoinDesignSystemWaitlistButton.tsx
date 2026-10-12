import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { submitDesignSystemsWaitlist } from "@/lib/design-system-waitlist";

export function JoinDesignSystemWaitlistButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const t = useT();
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinWaitlist = async () => {
    setJoining(true);
    setError(null);

    try {
      const pageUrl = new URL(
        agentNativePath("/design-systems"),
        window.location.origin,
      ).href;
      const result = await submitDesignSystemsWaitlist(pageUrl);
      if (result.status === "submitted") {
        setJoined(true);
      } else {
        setError(
          t(
            result.status === "unavailable"
              ? "designSystems.waitlist.unavailable"
              : "designSystems.waitlist.error",
          ),
        );
      }
    } catch {
      setError(t("designSystems.waitlist.error"));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className={compact ? "flex flex-col items-end gap-1" : "grid gap-2"}>
      <Button
        size={compact ? "sm" : "default"}
        variant={compact ? "outline" : "default"}
        className="cursor-pointer"
        disabled={joining || joined}
        onClick={() => void joinWaitlist()}
        aria-live="polite"
      >
        {joining ? (
          <>
            <Spinner className="size-3.5" />
            {t("designSystems.waitlist.joining")}
          </>
        ) : joined ? (
          t("designSystems.waitlist.joined")
        ) : (
          t("designSystems.waitlist.join")
        )}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
