import { MessagingSetupPanel } from "@/components/messaging-setup-panel";
import { DispatcherShell } from "@/components/dispatcher-shell";

export function meta() {
  return [{ title: "Messaging — Dispatcher" }];
}

export default function MessagingRoute() {
  return (
    <DispatcherShell
      title="Messaging"
      description="Connect Slack and Telegram directly in dispatcher so inbound conversations come through one place."
    >
      <MessagingSetupPanel />
    </DispatcherShell>
  );
}
