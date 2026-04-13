import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import { DispatcherShell } from "@/components/dispatcher-shell";
import { Button } from "@/components/ui/button";

export function meta() {
  return [{ title: "Identities — Dispatcher" }];
}

export default function IdentitiesRoute() {
  const { data } = useActionQuery("list-linked-identities", {});
  const createToken = useActionMutation("create-link-token", {
    onSuccess: () => toast.success("Link token created"),
  });

  return (
    <DispatcherShell
      title="Identities"
      description="Link external senders to workspace users."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Active links
            </h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => createToken.mutate({ platform: "slack" })}
              >
                New Slack token
              </Button>
              <Button
                onClick={() => createToken.mutate({ platform: "telegram" })}
              >
                New Telegram token
              </Button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {(data?.links || []).map((link) => (
              <div
                key={link.id}
                className="rounded-xl border bg-muted/30 px-4 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {link.externalUserName || link.externalUserId}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {link.platform} → {link.ownerEmail}
                </div>
              </div>
            ))}
            {(data?.links?.length || 0) === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                No linked identities yet. Generate a token and ask the user to
                send <code>/link TOKEN</code> from Slack or Telegram.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">Link tokens</h2>
          <div className="mt-4 space-y-3">
            {(data?.tokens || []).map((token) => (
              <div key={token.id} className="rounded-xl border px-4 py-3">
                <div className="text-sm font-medium text-foreground">
                  /link {token.token}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {token.platform} · expires{" "}
                  {new Date(token.expiresAt).toLocaleString()}
                  {token.claimedAt
                    ? ` · claimed by ${token.claimedByExternalUserName || token.claimedByExternalUserId}`
                    : " · waiting to be claimed"}
                </div>
              </div>
            ))}
            {(data?.tokens?.length || 0) === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                No active link tokens.
              </div>
            )}
          </div>
        </section>
      </div>
    </DispatcherShell>
  );
}
