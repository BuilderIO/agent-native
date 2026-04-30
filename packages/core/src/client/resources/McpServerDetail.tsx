import { agentNativePath } from "../api-path.js";
/**
 * Detail view for a virtual MCP server entry in the Workspace tree.
 *
 * Shown when the user clicks an `mcp-servers/<name>.json` entry. Servers
 * aren't editable in-place — today the server endpoints only support
 * create + delete, matching the Settings UX they replaced. Users can
 * delete and recreate if they need to change a URL or headers.
 */

import React, { useState } from "react";
import {
  IconPlugConnected,
  IconAlertTriangle,
  IconLoader2,
  IconCheck,
  IconTestPipe,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import {
  testMcpServerUrl,
  type McpServer,
  type TestMcpUrlResult,
} from "./use-mcp-servers.js";

interface McpServerDetailProps {
  server: McpServer;
}

export function McpServerDetail({ server }: McpServerDetailProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestMcpUrlResult | null>(null);

  const headers = server.headers ? Object.keys(server.headers) : [];

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // We don't have the real header values client-side (redacted). The
      // test-existing endpoint uses the stored headers, but there's no
      // convenient way to hit it from here without the server id + scope,
      // which we do have — so wire that up.
      const res = await fetch(
        agentNativePath(
          `/_agent-native/mcp/servers/${encodeURIComponent(server.id)}/test?scope=${server.scope}`,
        ),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        },
      );
      const body = (await res.json().catch(() => ({}))) as TestMcpUrlResult;
      setTestResult(body.ok ? body : { ok: false, error: body.error });
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message ?? String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          <IconPlugConnected className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[14px] font-medium text-foreground">
            {server.name}
          </h2>
          <StatusBadge server={server} />
        </div>

        {server.description && (
          <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
            {server.description}
          </p>
        )}

        <dl className="space-y-3">
          <Field label="Scope">
            <span className="text-[12px] text-foreground">
              {server.scope === "user" ? "Personal" : "Organization"}
            </span>
          </Field>

          <Field label="URL">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground break-all">
              {server.url}
            </code>
          </Field>

          {headers.length > 0 && (
            <Field label="Headers">
              <ul className="space-y-1">
                {headers.map((k) => (
                  <li
                    key={k}
                    className="flex items-center gap-2 text-[11px] text-muted-foreground"
                  >
                    <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                      {k}
                    </code>
                    <span className="italic">(hidden)</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}

          <Field label="Tools">
            <ToolsSummary server={server} />
          </Field>
        </dl>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent",
              testing && "opacity-60",
            )}
          >
            {testing ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <IconTestPipe className="h-3 w-3" />
            )}
            Test connection
          </button>
          {testResult && <TestResultLine result={testResult} />}
        </div>

        <p className="mt-6 rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          To change the URL, headers, or description, delete this entry and add
          a new server. Edits in place aren't supported yet.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function StatusBadge({ server }: { server: McpServer }) {
  if (server.status.state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Connected
      </span>
    );
  }
  if (server.status.state === "error") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400"
        title={server.status.error}
      >
        <IconAlertTriangle className="h-2.5 w-2.5" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
      Connecting…
    </span>
  );
}

function ToolsSummary({ server }: { server: McpServer }) {
  if (server.status.state === "connected") {
    return (
      <span className="text-[12px] text-foreground">
        {server.status.toolCount} tool
        {server.status.toolCount === 1 ? "" : "s"} exposed
      </span>
    );
  }
  if (server.status.state === "error") {
    return (
      <span className="text-[12px] text-red-600 dark:text-red-400">
        {server.status.error}
      </span>
    );
  }
  return (
    <span className="text-[12px] text-muted-foreground">
      Not connected yet — try the Test button.
    </span>
  );
}

function TestResultLine({ result }: { result: TestMcpUrlResult }) {
  if (result.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
        <IconCheck className="h-3 w-3" />
        {result.toolCount} tool{result.toolCount === 1 ? "" : "s"} available
      </span>
    );
  }
  return (
    <span className="text-[11px] text-red-600 dark:text-red-400">
      {result.error ?? "Failed"}
    </span>
  );
}
