import { useState } from "react";
import {
  useGreenhouseStatus,
  useGreenhouseDisconnect,
  useNotificationStatus,
  useSaveNotificationConfig,
  useDeleteNotificationConfig,
} from "@/hooks/use-greenhouse";
import { TeamPage } from "@agent-native/core/client/org";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  IconPlant2,
  IconCheck,
  IconLoader2,
  IconBrandSlack,
} from "@tabler/icons-react";
import { toast } from "sonner";

function OrgSection() {
  return (
    <TeamPage
      title="Organization"
      createOrgDescription="Set up a team to share candidate pipelines and hiring workflows with your colleagues."
    />
  );
}

export function SettingsPage() {
  const { data: status } = useGreenhouseStatus();
  const disconnect = useGreenhouseDisconnect();
  const { data: notifStatus } = useNotificationStatus();
  const saveNotif = useSaveNotificationConfig();
  const deleteNotif = useDeleteNotificationConfig();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showWebhookInput, setShowWebhookInput] = useState(false);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-8 sm:px-6 sm:py-8">
          {/* Organization */}
          <OrgSection />

          {/* Connection */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-4">
              Greenhouse Connection
            </h2>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600/10">
                    <IconPlant2 className="h-4.5 w-4.5 text-green-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Greenhouse Harvest API
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      {status?.connected ? (
                        <>
                          <IconCheck className="h-3 w-3 text-green-600" />
                          <span className="text-green-600">Connected</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Not connected
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {status?.connected && (
                  <button
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/30"
                  >
                    {disconnect.isPending ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Disconnect"
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Slack Notifications */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-4">
              Slack Notifications
            </h2>
            <div className="rounded-lg border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-600/10">
                    <IconBrandSlack className="h-4.5 w-4.5 text-purple-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Slack Webhook
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      {notifStatus?.configured ? (
                        <>
                          <IconCheck className="h-3 w-3 text-green-600" />
                          <span className="text-green-600">
                            {notifStatus.enabled
                              ? "Connected"
                              : "Configured (disabled)"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Not configured
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {notifStatus?.configured ? (
                  <button
                    onClick={() => deleteNotif.mutate()}
                    disabled={deleteNotif.isPending}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/30"
                  >
                    {deleteNotif.isPending ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Remove"
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowWebhookInput(true)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50"
                  >
                    Configure
                  </button>
                )}
              </div>

              {showWebhookInput && !notifStatus?.configured && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1.5">
                      Slack Incoming Webhook URL
                    </label>
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Create one at{" "}
                      <span className="font-medium">
                        Slack &gt; Settings &gt; Manage Apps &gt; Incoming
                        Webhooks
                      </span>
                      . Send it to a channel your recruiter watches.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await saveNotif.mutateAsync({
                            webhookUrl,
                            enabled: true,
                          });
                          setShowWebhookInput(false);
                          setWebhookUrl("");
                          toast.success("Slack webhook configured");
                        } catch (err: any) {
                          toast.error(err.message || "Failed to save webhook");
                        }
                      }}
                      disabled={!webhookUrl || saveNotif.isPending}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {saveNotif.isPending ? (
                        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setShowWebhookInput(false);
                        setWebhookUrl("");
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {notifStatus?.configured && (
                <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                  Pipeline status updates (overdue scorecards, new feedback,
                  stuck candidates) will be sent to your Slack channel. Use the
                  "Send Recruiter Update" button on the Action Items page, or
                  ask the agent to send an update.
                </p>
              )}
            </div>
          </div>

          {/* Appearance */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-4">
              Appearance
            </h2>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Theme
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Toggle between light and dark mode
                  </div>
                </div>
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
