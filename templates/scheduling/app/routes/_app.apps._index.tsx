import { useLoaderData } from "react-router";
import { callAction } from "@/lib/api";
import { Button } from "@/components/ui/button";

export async function loader() {
  // This loader runs server-side; call the action directly via fetch to keep
  // the code path the same as client calls.
  return { apps: [] };
}

export default function AppsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect calendars and video providers. Requires OAuth credentials in
        env.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <AppCard kind="google_calendar" label="Google Calendar" />
        <AppCard kind="office365_calendar" label="Outlook / Office 365" />
        <AppCard kind="zoom_video" label="Zoom" />
        <AppCard kind="cal_video" label="Cal Video" />
      </div>
    </div>
  );
}

function AppCard(props: { kind: string; label: string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <h3 className="font-medium">{props.label}</h3>
      <p className="mt-1 text-xs text-muted-foreground">Not connected</p>
      <Button
        className="mt-3"
        size="sm"
        variant="outline"
        onClick={async () => {
          const redirectUri = `${location.origin}/_agent-native/oauth/${props.kind}/callback`;
          const { authUrl } = await callAction("connect-calendar", {
            kind: props.kind,
            redirectUri,
          });
          if (authUrl) location.href = authUrl;
        }}
      >
        Connect
      </Button>
    </div>
  );
}
