import { describe, expect, it, vi } from "vitest";

import { computeComputerActionHash } from "../integrations/computer-supervision.js";
import type { ComputerCommandEnvelope } from "../integrations/remote-types.js";
import {
  callLocalComputerBridgeTool,
  dispatchComputerOperationToLocalBridge,
  loadLocalComputerBridgeConfig,
} from "./code-agent-connector.js";

describe("code agent connector computer bridge", () => {
  it("loads capabilities only from a fully authenticated loopback child env", () => {
    expect(
      loadLocalComputerBridgeConfig({
        AGENT_NATIVE_COMPUTER_BRIDGE_URL: "https://remote.example/mcp",
        AGENT_NATIVE_COMPUTER_BRIDGE_TOKEN: "example-desktop-child-token",
        AGENT_NATIVE_COMPUTER_CAPABILITIES: JSON.stringify({
          browser: { observe: true, control: true },
        }),
      }),
    ).toBeNull();

    expect(
      loadLocalComputerBridgeConfig({
        AGENT_NATIVE_COMPUTER_BRIDGE_URL: "http://127.0.0.1:47821/mcp",
        AGENT_NATIVE_COMPUTER_BRIDGE_TOKEN: "example-desktop-child-token",
        AGENT_NATIVE_COMPUTER_CAPABILITIES: JSON.stringify({
          browser: {
            observe: true,
            control: true,
            provider: "chrome-extension",
          },
          desktop: {
            observe: true,
            control: false,
            accessibility: true,
            screenCapture: true,
          },
        }),
      }),
    ).toEqual({
      url: "http://127.0.0.1:47821/mcp",
      token: "example-desktop-child-token",
      capabilities: {
        browser: {
          observe: true,
          control: true,
          provider: "chrome-extension",
          version: null,
        },
        desktop: {
          observe: true,
          control: false,
          accessibility: true,
          screenCapture: true,
          provider: null,
          version: null,
        },
      },
    });
  });

  it("fails closed without a local authenticated bridge", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      dispatchComputerOperationToLocalBridge(
        null,
        await makeEnvelope(),
        fetchMock,
      ),
    ).rejects.toThrow("bridge is unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves lease, hash, sequence, and idempotency in the MCP tool call", async () => {
    const envelope = await makeEnvelope();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "result-1",
          result: {
            structuredContent: { status: "completed", frameHandle: "frame-1" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const config = bridgeConfig();

    const result = await dispatchComputerOperationToLocalBridge(
      config,
      envelope,
      fetchMock,
    );

    const [, request] = fetchMock.mock.calls[0]!;
    expect(request?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer example-desktop-child-token",
      }),
    );
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "computer_operation",
        arguments: { envelope },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      taskId: envelope.taskId,
      runId: envelope.runId,
      sequence: envelope.sequence,
      idempotencyKey: envelope.idempotencyKey,
      actionHash: envelope.approval.actionHash,
    });
  });

  it("uses the MCP revoke tool for the control kill switch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "result-1",
          result: { ok: true },
        }),
        { status: 200 },
      ),
    );
    await callLocalComputerBridgeTool(
      bridgeConfig(),
      "computer_revoke_control",
      { taskId: "task-1", runId: "run-1", reason: "remote-stop" },
      fetchMock,
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.params).toEqual({
      name: "computer_revoke_control",
      arguments: {
        taskId: "task-1",
        runId: "run-1",
        reason: "remote-stop",
      },
    });
  });
});

function bridgeConfig() {
  return {
    url: "http://127.0.0.1:47821/mcp",
    token: "example-desktop-child-token",
    capabilities: {
      browser: { observe: true, control: true },
    },
  };
}

async function makeEnvelope(): Promise<ComputerCommandEnvelope> {
  const now = Date.now();
  const envelope: ComputerCommandEnvelope = {
    version: 1,
    taskId: "task-1",
    runId: "run-1",
    sequence: 7,
    idempotencyKey: "operation-7",
    operationClass: "browser.control",
    action: { type: "click", target: { role: "button", name: "Save" } },
    approval: {
      id: "approval-1",
      scope: "once",
      actionHash: "0".repeat(64),
    },
    issuedAt: now,
    leaseExpiresAt: now + 60_000,
  };
  envelope.approval.actionHash = await computeComputerActionHash(envelope);
  return envelope;
}
