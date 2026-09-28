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
let generationIssued = false;
let editIssued = false;
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
function tool(res: any, name: string, args: Record<string, unknown>) {
  callNames.push(name);
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
    res.end(JSON.stringify({ callNames, modelsSeen }));
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  const payload = await readBody(req);
  if (typeof payload.model === "string") modelsSeen.push(payload.model);
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const all = messages.map((m: any) => text(m.content)).join("\n");
  const results = messages.filter((m: any) => m.role === "tool");
  const designId =
    all.match(/Design id:\s*"([^"]+)"/)?.[1] ??
    all.match(/has design "([^"]+)"/)?.[1] ??
    "";
  if (all.includes("Generate a very short title")) {
    const id = ++requestId;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end(
      `${chunk(id, { role: "assistant", content: "Luna Orbit" })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
    );
    return;
  }
  if (results.length === 0) {
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
    tool(res, "generate-design", {
      designId,
      prompt: "Luna Orbit responsive desktop and mobile",
      files: JSON.stringify([
        { filename: "index.html", content: source, fileType: "html" },
      ]),
      devices: ["desktop", "mobile"],
    });
    return;
  }
  const resultText = results.map((m: any) => text(m.content)).join("\n");
  const fileId =
    resultText.match(/"savedFiles"\s*:\s*\[\s*\{\s*"id"\s*:\s*"([^"]+)/)?.[1] ??
    "";
  if (all.includes("selected mobile heading")) {
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
    tool(res, "edit-design", {
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
    });
    return;
  }
  const id = ++requestId;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
  res.end(
    `${chunk(id, { role: "assistant", content: "Done." })}${chunk(id, {}, "stop")}data: [DONE]\n\n`,
  );
});
server.listen(port, "127.0.0.1");
