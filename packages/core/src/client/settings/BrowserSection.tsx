import {
  IconBrowser,
  IconCheck,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";

export function BrowserSection() {
  const { status: builder, loading } = useBuilderStatus();
  const connected = builder?.configured ?? false;

  return (
    <SettingsSection
      icon={<IconBrowser size={14} />}
      title="Browser Automation"
      subtitle="Let agents control a real browser for web tasks. Requires Builder connection."
      connected={connected}
    >
      {loading ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <IconLoader2 size={10} className="animate-spin" />
          Checking Builder connection...
        </div>
      ) : connected ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-green-500">
            <IconCheck size={10} />
            Browser access enabled
            {builder?.orgName && (
              <span className="text-muted-foreground">({builder.orgName})</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Agents can request live browser sessions via{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[9px]">
              connect-builder
            </code>
          </p>
          {builder?.connectUrl && (
            <a
              href={builder.connectUrl}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
            >
              Reconnect
              <IconExternalLink size={10} />
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Connect Builder to provision browser sessions without wiring browser
            setup into every app.
          </p>
          {builder?.connectUrl && (
            <a
              href={builder.connectUrl}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80"
            >
              Connect Builder
              <IconExternalLink size={10} />
            </a>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
