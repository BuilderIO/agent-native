import { useJiraAuthStatus, useDisconnectJira } from "@/hooks/use-jira-auth";
import { JiraConnectBanner } from "@/components/JiraConnectBanner";
import { toast } from "sonner";

export function SettingsPage() {
  const { data: authStatus } = useJiraAuthStatus();
  const disconnectMutation = useDisconnectJira();

  const accounts = authStatus?.accounts || [];

  const handleDisconnect = (email: string) => {
    disconnectMutation.mutate(email, {
      onSuccess: () => toast.success("Disconnected"),
      onError: () => toast.error("Failed to disconnect"),
    });
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="rounded-lg border border-border p-4 sm:p-6">
        <h2 className="mb-1 text-[15px] font-semibold text-foreground">
          Jira Connection
        </h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Manage your Atlassian account connection
        </p>

        {accounts.length > 0 ? (
          <div className="space-y-3">
            {accounts.map((account: any) => (
              <div
                key={account.email}
                className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {account.email}
                  </div>
                  {account.cloudName && (
                    <div className="text-[12px] text-muted-foreground">
                      Site: {account.cloudName}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDisconnect(account.email)}
                  disabled={disconnectMutation.isPending}
                  className="shrink-0 self-start rounded-md px-3 py-2 text-[13px] text-destructive hover:bg-destructive/10"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        ) : (
          <JiraConnectBanner />
        )}
      </div>
    </div>
  );
}
