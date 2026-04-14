import { useState } from "react";
import {
  IconGitBranch,
  IconCheck,
  IconExternalLink,
  IconLoader2,
} from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";

interface AgentsRunResult {
  branchName: string | null;
  projectId: string;
  url: string;
  status: string;
}

export function BackgroundAgentSection() {
  const { status: builder } = useBuilderStatus();
  const connected = builder?.configured ?? false;

  const [projectUrl, setProjectUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentsRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreateBranch = async () => {
    if (!projectUrl.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/_agent-native/builder/agents-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: "Set up this project for development",
          projectUrl: projectUrl.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err?.message || "Failed to create branch");
    } finally {
      setRunning(false);
    }
  };

  return (
    <SettingsSection
      icon={<IconGitBranch size={14} />}
      title="Background Agent"
      subtitle="Make code changes from production mode. Builder creates a branch, the agent makes changes, and you get a preview URL."
      connected={connected}
    >
      {!connected ? (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Connect Builder to enable code changes from production. The agent
            will create branches and provide preview URLs.
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
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-green-500">
            <IconCheck size={10} />
            Builder connected
            {builder?.orgName && (
              <span className="text-muted-foreground">({builder.orgName})</span>
            )}
          </div>

          <div>
            <label className="text-[10px] font-medium text-foreground block mb-1">
              Builder Project URL or ID
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={projectUrl}
                onChange={(e) => setProjectUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBranch();
                }}
                placeholder="https://builder.io/app/projects/..."
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={handleCreateBranch}
                disabled={!projectUrl.trim() || running}
                className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
              >
                {running ? (
                  <IconLoader2 size={10} className="animate-spin" />
                ) : (
                  "Create branch"
                )}
              </button>
            </div>
          </div>

          {result && (
            <div className="rounded-md border border-green-800/40 bg-green-900/10 px-2.5 py-2">
              <div className="text-[10px] font-medium text-green-400 mb-1">
                Branch created
              </div>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-foreground hover:underline"
              >
                {result.url}
                <IconExternalLink size={10} />
              </a>
            </div>
          )}

          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      )}
    </SettingsSection>
  );
}
