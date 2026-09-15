import { DispatchShell } from "../../components/dispatch-shell";
import { MessagingSetupPanel } from "../../components/messaging-setup-panel";

export function meta() {
  return [{ title: "Messaging — Dispatch" }];
}

export default function MessagingRoute() {
  return (
    <DispatchShell
      title="Messaging"
      description="Connect Slack, Microsoft Teams, Discord interactions, Telegram, WhatsApp Cloud API, or provider-webhook email so supported inbound conversations reach one Dispatch inbox."
    >
      <MessagingSetupPanel />
    </DispatchShell>
  );
}
