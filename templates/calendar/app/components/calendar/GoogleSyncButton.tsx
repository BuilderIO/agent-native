import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { useSyncGoogle } from "@/hooks/use-google-auth";
import { cn } from "@/lib/utils";

export function GoogleSyncButton() {
  const t = useT();
  const syncGoogle = useSyncGoogle();
  const [lastResult, setLastResult] = useState<string | null>(null);

  function handleSync() {
    syncGoogle.mutate(undefined, {
      onSuccess: (data: any) => {
        const count = data?.synced ?? 0;
        setLastResult(t("googleSync.syncedCount", { count }));
        toast.success(t("googleSync.syncedFromGoogleCalendar", { count }));
      },
      onError: () => {
        toast.error(t("googleSync.failed"));
      },
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncGoogle.isPending}
      >
        <IconRefresh
          className={cn(
            "mr-1.5 h-3.5 w-3.5",
            syncGoogle.isPending && "animate-spin",
          )}
        />
        {t("googleSync.syncGoogle")}
      </Button>
      {lastResult && (
        <span className="text-xs text-muted-foreground">{lastResult}</span>
      )}
    </div>
  );
}
