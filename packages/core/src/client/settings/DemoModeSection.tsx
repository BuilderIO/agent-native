/**
 * <DemoModeSection /> — toggle that replaces names, emails, and numbers with
 * realistic fake data everywhere (UI + what the agent sees) while preserving
 * IDs and structure so the app keeps working.
 *
 * The toggle is stored in application_state under `demo-mode`
 * (`{ enabled: boolean }`) and written via `PUT
 * /_agent-native/application-state/demo-mode` (optimistic — flip first,
 * write in the background). It READS from `/_agent-native/demo/status`
 * instead, which ORs the per-user toggle with the `DEMO_MODE` env: a hosted
 * demo deployment is forced on and the switch is locked so it can't be
 * accidentally turned off on stage.
 */

import { IconEyeOff } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { agentNativePath } from "../api-path.js";

interface DemoStatus {
  enabled?: boolean;
  forced?: boolean;
}

const DEMO_STATUS_URL = agentNativePath("/_agent-native/demo/status");
const DEMO_MODE_WRITE_URL = agentNativePath(
  "/_agent-native/application-state/demo-mode",
);

export function DemoModeSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const { data } = useQuery({
    queryKey: ["agent-native", "demo-mode"],
    queryFn: async () => {
      const res = await fetch(DEMO_STATUS_URL, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      return (await res.json()) as DemoStatus | null;
    },
    refetchInterval: 4_000,
    staleTime: 2_000,
  });

  const serverEnabled = data?.enabled;
  const forced = data?.forced === true;

  // Surface the server value once it arrives (and on subsequent polls), but
  // never clobber an in-flight optimistic toggle with a stale read. When
  // forced by env, always reflect the locked-on state.
  useEffect(() => {
    if (forced) {
      setEnabled(true);
    } else if (typeof serverEnabled === "boolean") {
      setEnabled((prev) => (prev === null ? serverEnabled : prev));
    } else if (serverEnabled === undefined && data !== undefined) {
      setEnabled((prev) => (prev === null ? false : prev));
    }
  }, [serverEnabled, forced, data]);

  const toggle = async (next: boolean) => {
    if (forced) return;
    const previous = enabled;
    // Optimistic: flip immediately, write in the background.
    setEnabled(next);
    try {
      const res = await fetch(DEMO_MODE_WRITE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      setEnabled(previous);
    }
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-accent/30 px-2.5 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-foreground">
          Enable demo mode
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Replace names, emails, and numbers with realistic fake data everywhere
          — in the UI and what the agent sees. IDs and structure are preserved
          so the app keeps working.
        </p>
        {forced && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Enforced by the <code>DEMO_MODE</code> environment variable — can't
            be turned off here.
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!enabled}
        aria-label="Enable demo mode"
        disabled={enabled === null || forced}
        onClick={() => toggle(!enabled)}
        // Theme tokens; streaming agent owns layout.
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          enabled
            ? "bg-primary"
            : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
        } ${enabled === null || forced ? "opacity-60" : ""}`}
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
