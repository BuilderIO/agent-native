import { IconBrandSlack } from "@tabler/icons-react";
import { appPath, useActionQuery } from "@agent-native/core/client";

interface SlackInstallation {
  status: string;
}

interface SlackInstallationsResponse {
  oauthConfigured: boolean;
  installations: SlackInstallation[];
}

/**
 * Contextual nudge shown in the share popover's Link tab for public clips.
 *
 * A public Clips link unfurls into a playable video when pasted in a connected
 * Slack workspace, but that integration is otherwise only discoverable in
 * Settings. When a workspace is connected we confirm the payoff; when none is,
 * clip owners/admins get a one-click link to connect one in Settings.
 *
 * Only rendered for public clips (the caller gates on `isPublic`), so the
 * `list-slack-installations` query never runs for private shares.
 */
export function SlackShareHint({ canManage }: { canManage: boolean }) {
  const slack = useActionQuery<SlackInstallationsResponse>(
    "list-slack-installations",
    undefined,
    { retry: false },
  );

  const data = slack.data;
  const connected =
    data?.installations?.some((i) => i.status === "connected") ?? false;

  if (connected) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2">
        <IconBrandSlack className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-xs font-medium">Plays inline in Slack</div>
          <p className="text-[11px] text-muted-foreground">
            Paste this link in any connected workspace to play it inline.
          </p>
        </div>
      </div>
    );
  }

  // No workspace connected yet. Connecting needs the deployment's Slack OAuth
  // credentials, so only point managers at Settings when it's actually set up —
  // otherwise the Connect button there is disabled and the link is a dead end.
  // While the query is loading or errored, `data` is undefined and we render
  // nothing rather than guess at the workspace state.
  if (!data || !canManage || !data.oauthConfigured) return null;

  return (
    <a
      href={appPath("/settings#slack")}
      className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted/50"
    >
      <IconBrandSlack className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">Make it play inline in Slack</div>
        <p className="text-[11px] text-muted-foreground">
          Connect a workspace so this link unfurls as a video.
        </p>
      </div>
      <span className="shrink-0 text-xs font-medium text-primary">Connect</span>
    </a>
  );
}
