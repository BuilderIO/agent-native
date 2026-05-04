import { useSearchParams } from "react-router";
import {
  useActionMutation,
  useActionQuery,
  isInAgentEmbed,
  postNavigate,
  appPath,
} from "@agent-native/core/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  IconCheck,
  IconX,
  IconArrowUpRight,
  IconShieldCheck,
  IconClock,
  IconAlertCircle,
} from "@tabler/icons-react";

export function meta() {
  return [{ title: "Approval — Dispatch" }];
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      >
        <IconClock size={11} />
        Pending
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      >
        <IconCheck size={11} />
        Approved
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
    >
      <IconX size={11} />
      Rejected
    </Badge>
  );
}

export default function ApprovalPreviewRoute() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id") ?? "";

  const { data: approvals, isLoading } = useActionQuery(
    "list-dispatch-approvals",
    {},
  );

  const approve = useActionMutation("approve-dispatch-change", {
    onSuccess: () => toast.success("Change approved"),
  });
  const reject = useActionMutation("reject-dispatch-change", {
    onSuccess: () => toast.success("Change rejected"),
  });

  const inEmbed = isInAgentEmbed();

  const approval = approvals?.find((item) => item.id === id) ?? null;

  if (!id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center">
          <IconAlertCircle
            size={32}
            className="mx-auto mb-3 text-muted-foreground"
          />
          <p className="text-sm font-medium text-foreground">
            No approval id provided
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add <code className="rounded bg-muted px-1">?id=&lt;id&gt;</code> to
            the URL.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!approval) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center">
          <IconAlertCircle
            size={32}
            className="mx-auto mb-3 text-muted-foreground"
          />
          <p className="text-sm font-medium text-foreground">
            Approval not found
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The approval with id{" "}
            <code className="rounded bg-muted px-1">{id}</code> does not exist.
          </p>
          {inEmbed && (
            <Button
              size="sm"
              variant="outline"
              className="mt-4 gap-1.5"
              onClick={() => postNavigate(appPath("/approvals"))}
            >
              <IconArrowUpRight size={14} />
              View all approvals
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isPending = approval.status === "pending";

  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-muted text-foreground">
              <IconShieldCheck size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {approval.summary}
                </span>
                <StatusBadge status={approval.status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Requested by{" "}
                <span className="font-medium text-foreground">
                  {approval.requestedBy}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Change type</span>
              <span className="font-mono font-medium text-foreground">
                {approval.changeType}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Target type</span>
              <span className="font-mono font-medium text-foreground">
                {approval.targetType}
              </span>
            </div>
            {approval.targetId && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Target id</span>
                <span className="truncate font-mono font-medium text-foreground">
                  {approval.targetId}
                </span>
              </div>
            )}
            {approval.reviewedBy && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Reviewed by</span>
                <span className="font-medium text-foreground">
                  {approval.reviewedBy}
                </span>
              </div>
            )}
          </div>

          {isPending && (
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={approve.isPending || reject.isPending}
                onClick={() => approve.mutate({ id: approval.id })}
              >
                <IconCheck size={14} className="mr-1.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={approve.isPending || reject.isPending}
                onClick={() =>
                  reject.mutate({
                    id: approval.id,
                    reason: "Rejected in dispatch UI",
                  })
                }
              >
                <IconX size={14} className="mr-1.5" />
                Reject
              </Button>
            </div>
          )}
        </div>

        {inEmbed && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => postNavigate(appPath("/approvals"))}
            >
              <IconArrowUpRight size={14} />
              Open in app
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
