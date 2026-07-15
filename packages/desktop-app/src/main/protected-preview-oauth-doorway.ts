import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

const GOOGLE_STARTER_PATH = "/_agent-native/google/auth-url";
const GOOGLE_CALLBACK_PATH = "/_agent-native/google/callback";
const FLOW_TTL_MS = 5 * 60 * 1000;
const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "expires",
  "location",
  "pragma",
  "referrer-policy",
] as const;

interface DoorwayRegistration {
  targetOrigin: string;
  expiresAt: number;
}

function isSafeFlowId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{8,128}$/.test(value));
}

function normalizeLoopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      url.protocol !== "http:" ||
      !loopback ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function flowIdFromState(state: string | null): string | null {
  if (!state || state.length > 16_384) return null;
  try {
    const separator = state.lastIndexOf(".");
    if (separator <= 0) return null;
    const payload = JSON.parse(
      Buffer.from(state.slice(0, separator), "base64url").toString("utf8"),
    ) as { f?: unknown };
    return typeof payload.f === "string" && isSafeFlowId(payload.f)
      ? payload.f
      : null;
  } catch {
    return null;
  }
}

function requestFlowId(url: URL): string | null {
  if (url.pathname === GOOGLE_STARTER_PATH) {
    const flowId = url.searchParams.get("flow_id");
    return isSafeFlowId(flowId) ? flowId : null;
  }
  if (url.pathname === GOOGLE_CALLBACK_PATH) {
    return flowIdFromState(url.searchParams.get("state"));
  }
  return null;
}

function proxyHeaders(
  headers: IncomingHttpHeaders,
  target: URL,
  publicOrigin: string,
): OutgoingHttpHeaders {
  return {
    // OAuth uses this to distinguish desktop and mobile callback behavior.
    ...(headers["user-agent"] ? { "user-agent": headers["user-agent"] } : {}),
    host: target.host,
    "x-forwarded-host": new URL(publicOrigin).host,
    "x-forwarded-proto": "http",
  };
}

function proxyResponseHeaders(
  headers: IncomingHttpHeaders,
): OutgoingHttpHeaders {
  const forwarded: Record<string, string | string[]> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = headers[name];
    if (value !== undefined) forwarded[name] = value;
  }
  return forwarded;
}

export class ProtectedPreviewOAuthDoorway {
  private server: Server | null = null;
  private boundPort: number | null = null;
  private readonly registrations = new Map<string, DoorwayRegistration>();

  constructor(
    private readonly options: {
      port?: number;
      host?: string;
      publicOrigin?: string;
    } = {},
  ) {}

  get origin(): string {
    return (
      this.options.publicOrigin ??
      `http://localhost:${this.boundPort ?? this.options.port ?? 8080}`
    );
  }

  async register(flowId: string, targetOrigin: string): Promise<() => void> {
    if (!isSafeFlowId(flowId)) throw new Error("Invalid OAuth flow id.");
    const normalizedTarget = normalizeLoopbackOrigin(targetOrigin);
    if (!normalizedTarget) {
      throw new Error("OAuth doorway targets must be loopback HTTP origins.");
    }
    await this.ensureListening();
    this.prune();
    this.registrations.set(flowId, {
      targetOrigin: normalizedTarget,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return () => {
      this.registrations.delete(flowId);
      this.closeIfIdle();
    };
  }

  async close(): Promise<void> {
    this.registrations.clear();
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private prune(): void {
    const now = Date.now();
    for (const [flowId, registration] of this.registrations) {
      if (registration.expiresAt <= now) this.registrations.delete(flowId);
    }
  }

  private closeIfIdle(): void {
    this.prune();
    if (this.registrations.size !== 0 || !this.server) return;
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    server.close(() => {});
  }

  private async ensureListening(): Promise<void> {
    if (this.server?.listening) return;
    const server = http.createServer((request, response) => {
      this.handleRequest(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (this.server === server) this.server = null;
        this.boundPort = null;
        reject(
          error.code === "EADDRINUSE"
            ? new Error(
                `OAuth doorway ${this.origin} is already in use. Leave the current process alone and retry when the port is free.`,
              )
            : error,
        );
      };
      const onListening = () => {
        server.off("error", onError);
        this.boundPort = (server.address() as AddressInfo).port;
        server.unref();
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(
        this.options.port ?? 8080,
        this.options.host ?? "127.0.0.1",
      );
    });
  }

  private handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain" });
      response.end("Method not allowed");
      return;
    }
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? "/", this.origin);
    } catch {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Bad request");
      return;
    }
    const flowId = requestFlowId(requestUrl);
    this.prune();
    const registration = flowId ? this.registrations.get(flowId) : null;
    if (!registration) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("OAuth flow not found");
      return;
    }

    const target = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      registration.targetOrigin,
    );
    const proxyRequest = http.request(
      target,
      {
        method: "GET",
        headers: proxyHeaders(request.headers, target, this.origin),
      },
      (proxyResponse) => {
        response.writeHead(
          proxyResponse.statusCode ?? 502,
          proxyResponseHeaders(proxyResponse.headers),
        );
        proxyResponse.pipe(response);
      },
    );
    proxyRequest.once("error", () => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(502, { "content-type": "text/plain" });
      response.end("OAuth app is not available");
    });
    request.once("aborted", () => proxyRequest.destroy());
    proxyRequest.end();
  }
}
