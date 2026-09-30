import { useDemoModeStatus } from "@agent-native/core/client/hooks";
import { setBrowserDemoModeEnabled } from "@agent-native/core/demo/browser-state";
import { Switch } from "@agent-native/toolkit/design-system";

export function DemoModeSection({ compact = false }: { compact?: boolean }) {
  const { enabled } = useDemoModeStatus();

  if (compact) {
    return (
      <Switch
        checked={enabled}
        onChange={(checked) => setBrowserDemoModeEnabled(checked)}
        aria-label="Enable demo mode"
        className="shrink-0"
      />
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-accent/30 px-2.5 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-foreground">
          Enable demo mode
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Anonymize displayed emails in this browser and reshape supported
          dashboard charts for presentations. Backend, agent integrations, and
          agent results stay real and access-scoped.
        </p>
      </div>
      <Switch
        checked={enabled}
        onChange={(checked) => setBrowserDemoModeEnabled(checked)}
        aria-label="Enable demo mode"
        className="shrink-0"
      />
    </div>
  );
}
