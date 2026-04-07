import { useState } from "react";
import {
  useGreenhouseStatus,
  useGreenhouseDisconnect,
  useNotificationStatus,
  useSaveNotificationConfig,
  useDeleteNotificationConfig,
} from "@/hooks/use-greenhouse";
import {
  useOrg,
  useOrgMembers,
  useCreateOrg,
  useInviteMember,
  useOrgInvitations,
  useAcceptInvitation,
  useRemoveMember,
  useSwitchOrg,
} from "@/hooks/use-org";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  IconPlant2,
  IconCheck,
  IconLoader2,
  IconBrandSlack,
  IconBuilding,
  IconUserPlus,
  IconTrash,
  IconMail,
  IconCrown,
  IconShieldCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";

function OrgSection() {
  const { data: org } = useOrg();
  const { data: membersData } = useOrgMembers();
  const { data: invitationsData } = useOrgInvitations();
  const createOrg = useCreateOrg();
  const inviteMember = useInviteMember();
  const acceptInvitation = useAcceptInvitation();
  const removeMember = useRemoveMember();
  const switchOrg = useSwitchOrg();
  const [orgName, setOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);

  // Pending invitations for this user
  if (org?.pendingInvitations && org.pendingInvitations.length > 0) {
    return (
      <div>
        <h2 className="text-sm font-medium text-foreground mb-4">
          Organization
        </h2>
        <div className="space-y-3">
          {org.pendingInvitations.map((inv) => (
            <div
              key={inv.id}
              className="rounded-lg border border-border p-4 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-medium text-foreground">
                  {inv.orgName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Invited by {inv.invitedBy}
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    await acceptInvitation.mutateAsync(inv.id);
                    toast.success(`Joined ${inv.orgName}`);
                  } catch (err: any) {
                    toast.error(err.message || "Failed to accept invitation");
                  }
                }}
                disabled={acceptInvitation.isPending}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {acceptInvitation.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Accept"
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // No org yet — show create option
  if (!org?.orgId) {
    return (
      <div>
        <h2 className="text-sm font-medium text-foreground mb-4">
          Organization
        </h2>
        <div className="rounded-lg border border-border p-4">
          {!showCreateForm ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Create a team
                </div>
                <div className="text-xs text-muted-foreground">
                  Set up an organization to share Greenhouse data with your
                  recruiting team
                </div>
              </div>
              <button
                onClick={() => setShowCreateForm(true)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50"
              >
                Create
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Acme Inc."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-green-500"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      await createOrg.mutateAsync(orgName.trim());
                      setShowCreateForm(false);
                      setOrgName("");
                      toast.success("Organization created");
                    } catch (err: any) {
                      toast.error(
                        err.message || "Failed to create organization",
                      );
                    }
                  }}
                  disabled={!orgName.trim() || createOrg.isPending}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {createOrg.isPending ? (
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setOrgName("");
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Has org — show org details + members
  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const members = membersData?.members ?? [];
  const pendingInvites = invitationsData?.invitations ?? [];

  const roleIcon = (role: string) => {
    if (role === "owner")
      return <IconCrown className="h-3 w-3 text-amber-500" />;
    if (role === "admin")
      return <IconShieldCheck className="h-3 w-3 text-blue-500" />;
    return null;
  };

  const hasMultipleOrgs = (org.orgs?.length ?? 0) > 1;

  return (
    <div>
      <h2 className="text-sm font-medium text-foreground mb-4">Organization</h2>
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10">
              <IconBuilding className="h-4.5 w-4.5 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {org.orgName}
              </div>
              <div className="text-xs text-muted-foreground">
                {members.length} member{members.length !== 1 ? "s" : ""} · You
                are {org.role}
              </div>
            </div>
          </div>
          {hasMultipleOrgs && (
            <select
              value={org.orgId ?? ""}
              onChange={async (e) => {
                const newOrgId = e.target.value || null;
                try {
                  await switchOrg.mutateAsync(newOrgId);
                  toast.success(
                    newOrgId
                      ? `Switched to ${org.orgs?.find((o) => o.orgId === newOrgId)?.orgName}`
                      : "Switched to personal mode",
                  );
                } catch (err: any) {
                  toast.error(err.message || "Failed to switch");
                }
              }}
              disabled={switchOrg.isPending}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              {org.orgs?.map((o) => (
                <option key={o.orgId} value={o.orgId}>
                  {o.orgName}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Members list */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Members
          </div>
          {members.map((m) => (
            <div
              key={m.email}
              className="flex items-center justify-between py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{m.email}</span>
                {roleIcon(m.role)}
              </div>
              {isOwnerOrAdmin && m.email !== org.email && (
                <button
                  onClick={async () => {
                    try {
                      await removeMember.mutateAsync(m.email);
                      toast.success(`Removed ${m.email}`);
                    } catch (err: any) {
                      toast.error(err.message || "Failed to remove member");
                    }
                  }}
                  disabled={removeMember.isPending}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {/* Pending invitations */}
          {pendingInvites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between py-1.5 opacity-60"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{inv.email}</span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  Invited
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Invite form */}
        {isOwnerOrAdmin && (
          <div className="border-t border-border pt-3">
            {!showInviteForm ? (
              <button
                onClick={() => setShowInviteForm(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-green-600 hover:text-green-700"
              >
                <IconUserPlus className="h-3.5 w-3.5" />
                Invite member
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <IconMail className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@company.com"
                      className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-green-500"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await inviteMember.mutateAsync(inviteEmail.trim());
                        setInviteEmail("");
                        setShowInviteForm(false);
                        toast.success("Invitation sent");
                      } catch (err: any) {
                        toast.error(err.message || "Failed to invite");
                      }
                    }}
                    disabled={!inviteEmail.trim() || inviteMember.isPending}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {inviteMember.isPending ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Send"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowInviteForm(false);
                      setInviteEmail("");
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  They'll need to sign in with Google using this email to
                  accept.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
      {/* Header */}
      <div className="flex items-center border-b border-border px-4 h-14 flex-shrink-0 sm:px-6">
        <h1 className="text-sm font-semibold text-foreground pl-10 md:pl-0">
          Settings
        </h1>
      </div>

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
