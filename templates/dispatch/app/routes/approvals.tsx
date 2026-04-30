import { useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import { DispatchShell } from "@/components/dispatch-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function meta() {
  return [{ title: "Approvals — Dispatch" }];
}

export default function ApprovalsRoute() {
  const { data: settings } = useActionQuery("get-dispatch-settings", {});
  const { data: approvals } = useActionQuery("list-dispatch-approvals", {});
  const [emails, setEmails] = useState("");

  const approverList = useMemo(
    () =>
      emails
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [emails],
  );

  const savePolicy = useActionMutation("set-dispatch-approval-policy", {
    onSuccess: () => toast.success("Approval policy updated"),
    onError: (err) => toast.error(String(err)),
  });
  const approve = useActionMutation("approve-dispatch-change", {
    onSuccess: () => toast.success("Change approved"),
    onError: (err) => toast.error(String(err)),
  });
  const reject = useActionMutation("reject-dispatch-change", {
    onSuccess: () => toast.success("Change rejected"),
    onError: (err) => toast.error(String(err)),
  });

  return (
    <DispatchShell
      title="Approvals"
      description="Review durable dispatch changes before they apply."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Approval policy
          </h2>
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between rounded-xl border px-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Require approval for durable changes
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Applies to saved destinations and dispatch settings today.
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

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Pending and recent requests
          </h2>
          <div className="mt-4 space-y-3">
            {(approvals || []).map((approval) => (
              <div
                key={approval.id}
                className="rounded-xl border bg-muted/30 px-4 py-3"
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
                            reason: "Rejected in dispatch UI",
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
              <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                No approval requests yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
