import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconBookmark, IconBookmarkFilled, IconX } from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface KeepBannerProps {
  resourceType: "dashboard" | "analysis";
  resourceId: string;
  resourceName: string;
  keptAt: string | null | undefined;
  onKept?: () => void;
}

/**
 * Banner shown on dashboards and analyses during the one-time cleanup pass.
 * Users click "Keep" to mark a resource as wanted; unclaimed resources will
 * be deleted after the pass ends and visibility returns to private-by-default.
 */
export function KeepBanner({
  resourceType,
  resourceId,
  resourceName,
  keptAt,
  onKept,
}: KeepBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { mutateAsync: keepResource, isPending } =
    useActionMutation("keep-resource");

  if (dismissed) return null;

  if (keptAt) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
        <IconBookmarkFilled className="size-4 shrink-0" />
        <span>Marked as kept — this will survive the cleanup pass.</span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-100"
          aria-label="Dismiss"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40",
      )}
    >
      <IconBookmark className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="text-amber-900 dark:text-amber-200">
        <strong>Cleanup pass:</strong> all dashboards and analyses are
        temporarily org-visible. Click <strong>Keep</strong> to mark this one as
        wanted — anything unclaimed will be deleted and everything goes private
        again after the pass.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto shrink-0 border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-800/60"
        disabled={isPending}
        onClick={async () => {
          try {
            await keepResource({ resourceType, resourceId });
            toast.success(`"${resourceName}" marked as kept`);
            onKept?.();
          } catch (err: any) {
            toast.error(err?.message ?? "Failed to mark as kept");
          }
        }}
      >
        <IconBookmarkFilled className="mr-1.5 size-3.5" />
        Keep
      </Button>
    </div>
  );
}
