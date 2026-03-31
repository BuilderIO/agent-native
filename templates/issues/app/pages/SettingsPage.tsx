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
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-lg font-semibold text-foreground">Settings</h1>

      {/* Connection */}
      <div className="rounded-lg border border-border p-6">
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
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div>
                  <div className="text-[13px] font-medium text-foreground">
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
                  className="rounded-md px-3 py-1.5 text-[13px] text-destructive hover:bg-destructive/10"
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
