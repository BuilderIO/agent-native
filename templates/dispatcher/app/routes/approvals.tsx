import { useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import { DispatcherShell } from "@/components/dispatcher-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function meta() {
  return [{ title: "Approvals — Dispatcher" }];
}

export default function ApprovalsRoute() {
  const { data: settings } = useActionQuery("get-dispatcher-settings", {});
  const { data: approvals } = useActionQuery("list-dispatcher-approvals", {});
  const [emails, setEmails] = useState("");

  const approverList = useMemo(
    () =>
      emails
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [emails],
  );

  const savePolicy = useActionMutation("set-dispatcher-approval-policy", {
    onSuccess: () => toast.success("Approval policy updated"),
  });
  const approve = useActionMutation("approve-dispatcher-change", {
    onSuccess: () => toast.success("Change approved"),
  });
  const reject = useActionMutation("reject-dispatcher-change", {
    onSuccess: () => toast.success("Change rejected"),
  });

  return (
    <DispatcherShell
      title="Review durable behavior before it changes"
      description="Use approval flow to keep instructions, routes, and saved dispatcher behavior accountable across a team."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-3xl border border-border/60 bg-card/70 p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Approval policy
          </h2>
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between rounded-2xl border border-border/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Require approval for durable changes
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Applies to saved destinations and dispatcher settings today.
                </div>
              </div>
              <Switch
                checked={settings?.enabled || false}
                onCheckedChange={(checked) =>
                  savePolicy.mutate({
                    enabled: checked,
                    approverEmails: settings?.approverEmails || approverList,
                  })
                }
              />
            </label>
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                Approver emails
              </div>
              <Input
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                placeholder={(settings?.approverEmails || []).join(", ")}
              />
              <Button
                className="w-full"
                variant="outline"
                onClick={() =>
                  savePolicy.mutate({
                    enabled: settings?.enabled || false,
                    approverEmails: approverList,
                  })
                }
              >
                Save approvers
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border/60 bg-card/70 p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Pending and recent requests
          </h2>
          <div className="mt-4 space-y-3">
            {(approvals || []).map((approval) => (
              <div
                key={approval.id}
                className="rounded-2xl border border-border/50 bg-muted/35 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {approval.summary}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {approval.status} · requested by {approval.requestedBy}
                    </div>
                  </div>
                  {approval.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => approve.mutate({ id: approval.id })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reject.mutate({
                            id: approval.id,
                            reason: "Rejected in dispatcher UI",
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(approvals?.length || 0) === 0 && (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-sm text-muted-foreground">
                No approval requests yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </DispatcherShell>
  );
}
