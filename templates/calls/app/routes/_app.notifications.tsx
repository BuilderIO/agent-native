import { IconBell } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Notifications · Calls" }];
}

interface NotificationItem {
  id: string;
  kind: string;
  callId?: string | null;
  callTitle?: string | null;
  authorEmail?: string | null;
  preview?: string | null;
  createdAt: string;
}

export default function NotificationsRoute() {
  const { data, isLoading } = useActionQuery<{ items: NotificationItem[] }>(
    "list-notifications",
    undefined,
    { retry: false },
  );
  const items = data?.items ?? [];

  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2 truncate">
      <IconBell className="h-5 w-5 text-[#625DF5]" />
      Notifications
    </h1>,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-full bg-[#625DF5]/10 flex items-center justify-center mb-4">
              <IconBell className="h-8 w-8 text-[#625DF5]" />
            </div>
            <h2 className="text-lg font-semibold mb-1">No notifications yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              When someone comments on, reacts to, or shares a call with you,
              you'll see it here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border overflow-hidden">
            {items.map((n) => (
              <div key={n.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="font-medium">
                      {n.authorEmail ?? "Someone"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {n.kind === "comment"
                        ? "commented on"
                        : n.kind === "reaction"
                          ? "reacted to"
                          : n.kind === "share"
                            ? "shared"
                            : "updated"}
                    </span>{" "}
                    <span className="font-medium">{n.callTitle}</span>
                  </div>
                  {n.preview ? (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                      {n.preview}
                    </p>
                  ) : null}
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
