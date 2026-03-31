import { useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useSyncGoogle } from "@/hooks/use-google-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function GoogleSyncButton() {
  const syncGoogle = useSyncGoogle();
  const [lastResult, setLastResult] = useState<string | null>(null);

  function handleSync() {
    syncGoogle.mutate(undefined, {
      onSuccess: (data: { synced?: number }) => {
        const count = data?.synced ?? 0;
        setLastResult(`${count} event${count !== 1 ? "s" : ""} synced`);
        toast.success(
          `Synced ${count} event${count !== 1 ? "s" : ""} from Google Calendar`,
        );
      },
      onError: () => {
        toast.error("Failed to sync with Google Calendar");
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
        Sync Google
      </Button>
      {lastResult && (
        <span className="text-xs text-muted-foreground">{lastResult}</span>
      )}
    </div>
  );
}
