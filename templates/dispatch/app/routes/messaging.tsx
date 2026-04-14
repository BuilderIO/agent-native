import { MessagingSetupPanel } from "@/components/messaging-setup-panel";
import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "Messaging — Dispatch" }];
}

export default function MessagingRoute() {
  return (
    <DispatchShell
      title="Messaging"
      description="Connect Slack and Telegram directly in dispatch so inbound conversations come through one place."
    >
      <MessagingSetupPanel />
    </DispatchShell>
  );
}
