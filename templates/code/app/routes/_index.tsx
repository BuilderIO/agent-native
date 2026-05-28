import { useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  CodeAgentsApp,
  type CodeAgentsHost,
} from "@agent-native/code-agents-ui";
import type { CodeAgentsOpenRequest } from "@agent-native/code-agents-ui/types";
import { agentNativePath } from "@agent-native/core/client";

export function meta() {
  return [
    { title: "Agent-Native Code" },
    {
      name: "description",
      content:
        "A customizable local Agent-Native Code UI built from @agent-native/code-agents-ui.",
    },
  ];
}

export default function CodeAgentsPage() {
  const [searchParams] = useSearchParams();
  const openRequest = useMemo<CodeAgentsOpenRequest | undefined>(() => {
    const runId = searchParams.get("run") ?? undefined;
    const goalId = searchParams.get("goal") ?? undefined;
    return runId || goalId ? { runId, goalId, nonce: Date.now() } : undefined;
  }, [searchParams]);

  const host = useMemo<CodeAgentsHost>(
    () => ({
      listRuns: (goalId) =>
        callAction("list-code-agent-runs", { goalId }, "GET"),
      listCodePacks: (cwd) =>
        callAction("list-code-agent-packs", { cwd }, "GET"),
      createRun: (request) =>
        callAction("create-code-agent-run", request as unknown as JsonRecord),
      readTranscript: (request) =>
        callAction(
          "read-code-agent-transcript",
          request as unknown as JsonRecord,
          "GET",
        ),
      appendFollowUp: (request) =>
        callAction(
          "append-code-agent-follow-up",
          request as unknown as JsonRecord,
        ),
      updateRun: (request) =>
        callAction("update-code-agent-run", request as unknown as JsonRecord),
      controlRun: (goalId, runId, command, permissionMode) =>
        callAction("control-code-agent-run", {
          goalId,
          runId,
          command,
          permissionMode,
        }),
    }),
    [],
  );

  return (
    <div className="h-screen min-h-0 w-full overflow-hidden">
      <CodeAgentsApp apps={[]} host={host} openRequest={openRequest} />
    </div>
  );
}

async function callAction<T>(
  name: string,
  params: JsonRecord = {},
  method: "GET" | "POST" = "POST",
): Promise<T> {
  let url = agentNativePath(`/_agent-native/actions/${name}`);
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  };

  if (method === "GET") {
    const entries = Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null,
    );
    if (entries.length > 0) {
      url += `?${new URLSearchParams(
        entries.map(([key, value]) => [key, String(value)]),
      )}`;
    }
  } else {
    init.body = JSON.stringify(params);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      data?.error ?? data?.message ?? res.statusText ?? `HTTP ${res.status}`,
    );
  }
  return data as T;
}

type JsonRecord = Record<string, unknown>;
