import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const source = await readFile(
  new URL("./fixtures/luna-orbit-after-ai.html", import.meta.url),
  "utf8",
);
const port = Number(process.env.E2E_LOOPBACK_PORT ?? 41999);
let requestId = 0;
const callNames: string[] = [];
const modelsSeen: string[] = [];
const imageDataUrlsSeen: string[] = [];
const imageSha256Seen: string[] = [];
const imageUrlsSeen: string[] = [];
const requestSummaries: Array<{
  designId: string;
  roles: string[];
  userMessages: string[];
  imageCount: number;
  availableTools: string[];
  responseMode: "observe" | "edit" | "linkedin-ad";
  linkedinAdPromptMatched: boolean;
  editPromptMatched: boolean;
  generationIssuedBefore: boolean;
  toolResults: string[];
  assistantToolCalls: Array<{ name: string; arguments: string }>;
}> = [];
let configuredEditTarget: { designId: string; fileId: string } | null = null;
let configuredResponseMode: "observe" | "edit" | "linkedin-ad" = "edit";
const toolCallsSeen: Array<{
  name: string;
  designId?: string;
  fileId?: string;
  fileCount?: number;
  prompt?: string;
  imageCount: number;
  imageSha256: string[];
}> = [];
let generationIssued = false;
let editIssued = false;
let holdResponseFor: string | null = null;
let releaseHeldResponse: (() => void) | null = null;
const text = (v: unknown) =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v
          .map((p) =>
            p && typeof p === "object" && "text" in p
              ? String((p as any).text)
              : "",
          )
          .join("")
      : "";
function collectImageDataUrls(value: unknown): string[] {
  const found: string[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    if (record.type === "image_url") {
      const imageUrl = record.image_url;
      const url =
        typeof imageUrl === "string"
          ? imageUrl
          : imageUrl &&
              typeof imageUrl === "object" &&
              typeof (imageUrl as Record<string, unknown>).url === "string"
            ? String((imageUrl as Record<string, unknown>).url)
            : undefined;
      if (url?.startsWith("data:image/")) found.push(url);
      else if (url) imageUrlsSeen.push(url);
    } else if (record.type === "image") {
      const mediaType =
        typeof record.mediaType === "string" ? record.mediaType : undefined;
      const data =
        typeof record.data === "string"
          ? record.data
          : typeof record.image === "string"
            ? record.image
            : undefined;
      if (data?.startsWith("data:image/")) {
        found.push(data);
      } else if (mediaType?.startsWith("image/") && data) {
        found.push(`data:${mediaType};base64,${data}`);
      }
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return found;
}
const readBody = async (req: any) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return JSON.parse(Buffer.concat(chunks).toString());
};
const chunk = (
  id: number,
  delta: Record<string, unknown>,
  finish_reason?: string,
) =>
  `data: ${JSON.stringify({ id: `loopback-${id}`, object: "chat.completion.chunk", created: 1_788_000_000, model: "agentkit-loopback", choices: [{ index: 0, delta, finish_reason: finish_reason ?? null }] })}\n\n`;
function tool(
  res: any,
  name: string,
  args: Record<string, unknown>,
  requestImages: { count: number; sha256: string[] },
) {
  callNames.push(name);
  let fileCount: number | undefined;
  if (Array.isArray(args.files)) {
    fileCount = args.files.length;
  } else if (typeof args.files === "string") {
    try {
      const files = JSON.parse(args.files);
      if (Array.isArray(files)) fileCount = files.length;
    } catch {
      // coercion-ok: malformed fake tool arguments intentionally reach the app's validation path.
      // Keep sending malformed tool arguments so the application reports the validation error.
    }
  }
  toolCallsSeen.push({
    name,
    ...(typeof args.designId === "string" ? { designId: args.designId } : {}),
    ...(typeof args.fileId === "string" ? { fileId: args.fileId } : {}),
    ...(fileCount !== undefined ? { fileCount } : {}),
    ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
    imageCount: requestImages.count,
    imageSha256: requestImages.sha256,
  });
  const id = ++requestId;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
  res.write(chunk(id, { role: "assistant" }));
  res.write(
    chunk(id, {
      tool_calls: [
        {
          index: 0,
          id: `tool-${id}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }),
  );
  res.write(chunk(id, {}, "tool_calls"));
  res.end("data: [DONE]\n\n");
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ object: "list", data: [{ id: "agentkit-loopback" }] }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/__state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        callNames,
        modelsSeen,
        imageDataUrlsSeen,
        imageSha256Seen,
        requestSummaries,
        toolCallsSeen,
        configuredResponseMode,
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/__proof") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        callNames,
        modelsSeen,
        imageSha256Seen,
        imageUrlsSeen,
        requestSummaries,
        toolCallsSeen,
      }),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/__configure") {
    const configuration = await readBody(req);
    if (
      typeof configuration.designId !== "string" ||
      typeof configuration.fileId !== "string" ||
      !["observe", "edit", "linkedin-ad"].includes(configuration.mode)
    ) {
      res
        .writeHead(400)
        .end("designId, fileId, and a supported mode are required");
      return;
    }
    configuredEditTarget = {
      designId: configuration.designId,
      fileId: configuration.fileId,
    };
    configuredResponseMode = configuration.mode;
    callNames.length = 0;
    modelsSeen.length = 0;
    imageDataUrlsSeen.length = 0;
    imageUrlsSeen.length = 0;
    imageSha256Seen.length = 0;
    requestSummaries.length = 0;
    toolCallsSeen.length = 0;
    generationIssued = false;
    editIssued = false;
    holdResponseFor = null;
    releaseHeldResponse?.();
    res.writeHead(204).end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/__hold-next-response") {
    const { userMessageStartsWith } = await readBody(req);
    if (typeof userMessageStartsWith !== "string" || !userMessageStartsWith) {
      res.writeHead(400).end("userMessageStartsWith is required");
      return;
    }
    holdResponseFor = userMessageStartsWith;
    res.writeHead(204).end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/__release-held-response") {
    if (!releaseHeldResponse) {
      res.writeHead(409).end("no response is held");
      return;
    }
    releaseHeldResponse();
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  const payload = await readBody(req);
  if (typeof payload.model === "string") modelsSeen.push(payload.model);
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const imageDataUrls = collectImageDataUrls(messages);
  imageDataUrlsSeen.push(...imageDataUrls);
  for (const dataUrl of imageDataUrls) {
    const base64 = dataUrl.split(",", 2)[1];
    if (base64) {
      imageSha256Seen.push(
        createHash("sha256")
          .update(Buffer.from(base64, "base64"))
          .digest("hex"),
      );
    }
  }
  const all = messages.map((m: any) => text(m.content)).join("\n");
  const results = messages.filter((m: any) => m.role === "tool");
  const availableTools = Array.isArray(payload.tools)
    ? payload.tools.flatMap((entry: any) =>
        typeof entry?.function?.name === "string" ? [entry.function.name] : [],
      )
    : [];
  const designId =
    all.match(/Design id:\s*"([^"]+)"/)?.[1] ??
    all.match(/has design "([^"]+)"/)?.[1] ??
    "";
  const linkedinAdPromptMatched = all.includes(
    "Create a LinkedIn single-image ad at exactly 1200x627 pixels",
  );
  requestSummaries.push({
    designId,
    roles: messages.map((message: any) => String(message.role ?? "unknown")),
    imageCount: imageDataUrls.length,
    responseMode: configuredResponseMode,
    linkedinAdPromptMatched,
    editPromptMatched: all.includes(
      "Increase the selected heading's font size",
    ),
    generationIssuedBefore: generationIssued,
    userMessages: messages
      .filter((message: any) => message.role === "user")
      .map((message: any) => text(message.content).slice(0, 1_000)),
    availableTools,
    toolResults: results.map((message: any) =>
      text(message.content).slice(0, 1_000),
    ),
    assistantToolCalls: messages
      .filter(
        (message: any) =>
          message.role === "assistant" && Array.isArray(message.tool_calls),
      )
      .flatMap((message: any) =>
        message.tool_calls.map((call: any) => ({
          name: String(call.function?.name ?? ""),
          arguments: String(call.function?.arguments ?? "").slice(0, 1_000),
        })),
      ),
  });
  const latestUserMessage = text(
    messages.filter((message: any) => message.role === "user").at(-1)?.content,
  );
  // Only the agent turn offers tools; a title request for the same text does not.
  if (
    holdResponseFor &&
    availableTools.length > 0 &&
    latestUserMessage.startsWith(holdResponseFor)
  ) {
    holdResponseFor = null;
    await new Promise<void>((resolve) => {
      releaseHeldResponse = () => {
        releaseHeldResponse = null;
        resolve();
      };
    });
  }
  if (all.includes("Generate a very short title")) {
    const id = ++requestId;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end(
      `${chunk(id, { role: "assistant", content: "Luna Orbit" })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
    );
    return;
  }
  if (configuredResponseMode === "observe") {
    const id = ++requestId;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end(
      `${chunk(id, { role: "assistant", content: "I received the uploaded image reference." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
    );
    return;
  }
  if (configuredResponseMode === "linkedin-ad" && linkedinAdPromptMatched) {
    if (
      imageDataUrls.length === 0 ||
      !availableTools.includes("generate-design")
    ) {
      const id = ++requestId;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.end(
        `${chunk(id, { role: "assistant", content: "I’ll inspect the uploaded reference and create the requested canvas." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
      );
      return;
    }
    if (generationIssued) {
      const id = ++requestId;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.end(
        `${chunk(id, { role: "assistant", content: "Done." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
      );
      return;
    }
    generationIssued = true;
    tool(
      res,
      "generate-design",
      {
        designId: configuredEditTarget?.designId ?? designId,
        prompt:
          "Create a LinkedIn single-image ad at exactly 1200x627 pixels. Use the uploaded PNG as visual inspiration and include this copy: Launch your next campaign with confidence.",
        files: [{ filename: "index.html", content: source, fileType: "html" }],
      },
      {
        count: imageDataUrls.length,
        sha256: imageDataUrls.map((dataUrl) => {
          const base64 = dataUrl.split(",", 2)[1];
          return base64
            ? createHash("sha256")
                .update(Buffer.from(base64, "base64"))
                .digest("hex")
            : "";
        }),
      },
    );
    return;
  }
  if (
    configuredEditTarget &&
    all.includes("Increase the selected heading's font size")
  ) {
    if (!availableTools.includes("edit-design")) {
      const id = ++requestId;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.end(
        `${chunk(id, { role: "assistant", content: "I have the selected heading and will apply the requested edit." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
      );
      return;
    }
    if (editIssued) {
      const id = ++requestId;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.end(
        `${chunk(id, { role: "assistant", content: "Done." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
      );
      return;
    }
    editIssued = true;
    tool(
      res,
      "edit-design",
      {
        designId: configuredEditTarget.designId,
        fileId: configuredEditTarget.fileId,
        mode: "search-replace",
        edits: [
          {
            search: ".title { font-size: 36px; line-height: 1.15; }",
            replace: ".title { font-size: 48px; line-height: 1.15; }",
          },
        ],
      },
      {
        count: imageDataUrls.length,
        sha256: imageSha256Seen.slice(-imageDataUrls.length),
      },
    );
    return;
  }
  if (availableTools.includes("generate-design") && results.length === 0) {
    if (generationIssued) {
      const id = ++requestId;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.end(
        `${chunk(id, { role: "assistant", content: "Done." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
      );
      return;
    }
    generationIssued = true;
    tool(
      res,
      "generate-design",
      {
        designId,
        prompt: "Luna Orbit responsive desktop and mobile",
        files: [{ filename: "index.html", content: source, fileType: "html" }],
        devices: ["desktop", "mobile"],
      },
      {
        count: imageDataUrls.length,
        sha256: imageSha256Seen.slice(-imageDataUrls.length),
      },
    );
    return;
  }
  const resultText = results.map((m: any) => text(m.content)).join("\n");
  const fileId =
    resultText.match(/"savedFiles"\s*:\s*\[\s*\{\s*"id"\s*:\s*"([^"]+)/)?.[1] ??
    "";
  if (all.includes("Increase the selected heading's font size")) {
    if (editIssued) {
      const id = ++requestId;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.end(
        `${chunk(id, { role: "assistant", content: "Done." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
      );
      return;
    }
    editIssued = true;
    tool(
      res,
      "edit-design",
      {
        designId,
        fileId,
        mode: "search-replace",
        edits: JSON.stringify([
          {
            search: "</style>",
            replace:
              "@media (max-width: 390px) { .title { font-size: 48px !important; } }\n    </style>",
          },
        ]),
      },
      {
        count: imageDataUrls.length,
        sha256: imageSha256Seen.slice(-imageDataUrls.length),
      },
    );
    return;
  }
  const id = ++requestId;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
  res.end(
    `${chunk(id, { role: "assistant", content: "Done." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
  );
});
server.listen(port, "127.0.0.1");
