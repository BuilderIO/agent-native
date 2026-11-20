import { agentNativePath } from "@agent-native/core/client/api-path";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { useEffect, useState } from "react";

const SETTING_PATH = "/_agent-native/settings/no-approvals";

export async function fetchNoApprovals(): Promise<boolean | null> {
  const response = await fetch(agentNativePath(SETTING_PATH), {
    credentials: "include",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load the approvals setting.");
  const body = (await response.json()) as { enabled?: unknown };
  return typeof body.enabled === "boolean" ? body.enabled : null;
}

export async function saveNoApprovals(enabled: boolean): Promise<void> {
  const response = await fetch(agentNativePath(SETTING_PATH), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error("Could not save the approvals setting.");
}

export function ApprovalsTab() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchNoApprovals()
      .then((value) => live && setEnabled(value ?? false))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const toggle = (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setFailed(false);
    saveNoApprovals(next).catch(() => {
      setEnabled(previous);
      setFailed(true);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
      <label
        htmlFor="no-approvals-switch"
        className="text-sm font-medium text-foreground"
      >
        No approvals
      </label>
      <Switch
        id="no-approvals-switch"
        checked={enabled === true}
        disabled={enabled === null && !failed}
        onCheckedChange={toggle}
        aria-invalid={failed}
      />
    </div>
  );
}
