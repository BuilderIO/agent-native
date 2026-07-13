/** Browser-local presentation toggle. Backend and agent results stay real. */

import { IconEyeOff } from "@tabler/icons-react";

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
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Enable demo mode"
        onClick={() => setBrowserDemoModeEnabled(!enabled)}
        // Theme tokens; streaming agent owns layout.
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          enabled
            ? "bg-primary"
            : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
            enabled ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function DemoModeIcon() {
  return <IconEyeOff size={14} />;
}
