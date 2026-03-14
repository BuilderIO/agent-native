import type { Request, Response } from "express";
import type {
  A2AConfig,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
  Artifact,
} from "./types.js";
import { createTask, getTask, updateTask } from "./task-store.js";
import { agentChat } from "../shared/agent-chat.js";

/**
 * Default A2A handler that delegates to agentChat.call().
 * Used when no custom handler is provided in A2AConfig.
 */
const defaultHandler: A2AHandler = async (
  message: Message,
  context: A2AHandlerContext,
): Promise<A2AHandlerResult> => {
  // Extract text from message parts
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");

  if (!text) {
    return {
      message: {
        role: "agent",
        parts: [{ type: "text", text: "No text content in message" }],
      },
    };
  }

  const result = await agentChat.call(text);

  const artifacts: Artifact[] = [];
  if (result.filesChanged.length > 0) {
    artifacts.push({
      name: "files-changed",
      description: "Files modified by the agent",
      parts: [{ type: "data", data: { files: result.filesChanged } }],
    });
  }

  return {
    message: {
      role: "agent",
      parts: [
        { type: "text", text: result.response },
        ...(result.warnings?.length
          ? [
              {
                type: "text" as const,
                text: `\n\nWarnings:\n${result.warnings.join("\n")}`,
              },
            ]
          : []),
      ],
    },
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
};

function getHandler(config: A2AConfig): A2AHandler {
  return config.handler ?? defaultHandler;
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResult(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeHandlerContext(
  taskId: string,
  contextId?: string,
): {
  context: A2AHandlerContext;
  artifacts: Artifact[];
} {
  const artifacts: Artifact[] = [];
  const context: A2AHandlerContext = {
    taskId,
    contextId,
    writeArtifact(name, content, mimeType) {
      const artifact: Artifact = {
        name,
        parts: mimeType
          ? [
              {
                type: "file",
                file: {
                  name,
                  mimeType,
                  bytes: Buffer.from(content).toString("base64"),
                },
              },
            ]
          : [{ type: "text", text: content }],
      };
      artifacts.push(artifact);
      return name;
    },
  };
  return { context, artifacts };
}

async function handleSend(
  params: Record<string, unknown>,
  config: A2AConfig,
): Promise<JsonRpcResponse & { _id: string | number }> {
  const message = params.message as Message;
  if (!message || !message.role || !Array.isArray(message.parts)) {
    return {
      ...jsonRpcError(
        0,
        -32602,
        "Invalid params: message with role and parts required",
      ),
      _id: 0,
    };
  }

  const contextId = params.contextId as string | undefined;
  const task = createTask(message, contextId);

  updateTask(task.id, { state: "working" });

  const { context, artifacts } = makeHandlerContext(task.id, contextId);

  try {
    const result = getHandler(config)(message, context);

    // Check if it's an async generator
    if (
      result &&
      typeof result === "object" &&
      Symbol.asyncIterator in result
    ) {
      // For non-streaming send, collect all messages
      let lastMessage: Message | undefined;
      for await (const msg of result as AsyncGenerator<Message>) {
        lastMessage = msg;
      }
      const allArtifacts = [...artifacts];
      const updated = updateTask(task.id, {
        state: "completed",
        message: lastMessage,
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      });
      return { ...jsonRpcResult(0, updated), _id: 0 };
    }

    // Promise-based handler
    const handlerResult = await (result as Promise<A2AHandlerResult>);
    const allArtifacts = [...artifacts, ...(handlerResult.artifacts ?? [])];
    const updated = updateTask(task.id, {
      state: "completed",
      message: handlerResult.message,
      artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
    });
    return { ...jsonRpcResult(0, updated), _id: 0 };
  } catch (err: any) {
    updateTask(task.id, {
      state: "failed",
      message: {
        role: "agent",
        parts: [{ type: "text", text: err.message ?? "Handler failed" }],
      },
    });
    return {
      ...jsonRpcError(0, -32000, err.message ?? "Handler failed"),
      _id: 0,
    };
  }
}

async function handleStream(
  params: Record<string, unknown>,
  config: A2AConfig,
  res: Response,
): Promise<void> {
  const message = params.message as Message;
  if (!message || !message.role || !Array.isArray(message.parts)) {
    res.write(
      `data: ${JSON.stringify(jsonRpcError(0, -32602, "Invalid params"))}\n\n`,
    );
    res.end();
    return;
  }

  const contextId = params.contextId as string | undefined;
  const task = createTask(message, contextId);

  updateTask(task.id, { state: "working" });

  const { context, artifacts } = makeHandlerContext(task.id, contextId);

  try {
    const result = getHandler(config)(message, context);

    if (
      result &&
      typeof result === "object" &&
      Symbol.asyncIterator in result
    ) {
      for await (const msg of result as AsyncGenerator<Message>) {
        const intermediate = updateTask(task.id, {
          state: "working",
          message: msg,
        });
        res.write(
          `data: ${JSON.stringify(jsonRpcResult(0, intermediate))}\n\n`,
        );
      }
    } else {
      const handlerResult = await (result as Promise<A2AHandlerResult>);
      const allArtifacts = [...artifacts, ...(handlerResult.artifacts ?? [])];
      const updated = updateTask(task.id, {
        state: "completed",
        message: handlerResult.message,
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      });
      res.write(`data: ${JSON.stringify(jsonRpcResult(0, updated))}\n\n`);
      res.end();
      return;
    }

    const allArtifacts = [...artifacts];
    const final = updateTask(task.id, {
      state: "completed",
      artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
    });
    res.write(`data: ${JSON.stringify(jsonRpcResult(0, final))}\n\n`);
  } catch (err: any) {
    updateTask(task.id, { state: "failed" });
    res.write(
      `data: ${JSON.stringify(jsonRpcError(0, -32000, err.message ?? "Handler failed"))}\n\n`,
    );
  }

  res.end();
}

function handleGet(params: Record<string, unknown>): JsonRpcResponse {
  const id = params.id as string;
  if (!id) {
    return jsonRpcError(0, -32602, "Invalid params: id required");
  }
  const task = getTask(id);
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  return jsonRpcResult(0, task);
}

function handleCancel(params: Record<string, unknown>): JsonRpcResponse {
  const id = params.id as string;
  if (!id) {
    return jsonRpcError(0, -32602, "Invalid params: id required");
  }
  const task = updateTask(id, { state: "canceled" });
  if (!task) {
    return jsonRpcError(0, -32001, "Task not found");
  }
  return jsonRpcResult(0, task);
}

export async function handleJsonRpc(
  req: Request,
  res: Response,
  config: A2AConfig,
): Promise<void> {
  const body = req.body as JsonRpcRequest;

  if (!body || body.jsonrpc !== "2.0" || !body.method) {
    res
      .status(400)
      .json(jsonRpcError(body?.id ?? null, -32600, "Invalid JSON-RPC request"));
    return;
  }

  const params = body.params ?? {};
  const id = body.id;

  switch (body.method) {
    case "message/send": {
      const result = await handleSend(params, config);
      const { _id, ...response } = result;
      res.json({ ...response, id });
      return;
    }
    case "message/stream": {
      if (!config.streaming) {
        res.json(jsonRpcError(id, -32601, "Streaming not supported"));
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      await handleStream(params, config, res);
      return;
    }
    case "tasks/get": {
      const result = handleGet(params);
      res.json({ ...result, id });
      return;
    }
    case "tasks/cancel": {
      const result = handleCancel(params);
      res.json({ ...result, id });
      return;
    }
    default:
      res.json(jsonRpcError(id, -32601, `Method not found: ${body.method}`));
  }
}
