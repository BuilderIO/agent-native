/** Browser-local presentation toggle. Backend and agent results stay real. */

import { IconEyeOff } from "@tabler/icons-react";
import { Switch } from "@agent-native/toolkit/design-system";

import { setBrowserDemoModeEnabled } from "../../demo/browser-state.js";
import { useDemoModeStatus } from "../use-demo-mode-status.js";

export function DemoModeSection() {
  const { enabled } = useDemoModeStatus();

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-accent/30 px-2.5 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-foreground">
          Enable demo mode
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Anonymize displayed emails in this browser and reshape supported
          dashboard charts for presentations. Backend, MCP, and agent results
          stay real and access-scoped.
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

export function DemoModeIcon() {
  return <IconEyeOff size={14} />;
}
