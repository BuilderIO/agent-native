import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn());
vi.mock("./builder-dsi-access.js", () => ({ assertBuilderDsiAccess: access }));
vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: auth,
}));
vi.mock("./builder-design-systems.js", () => ({
  getBuilderDesignSystemsBaseUrl: () =>
    "https://builder.example.test/design-systems/v1",
}));

import {
  getBuilderDsiSession,
  publishBuilderDsiSession,
  readBuilderDsiArtifact,
  readBuilderDsiSessionByRequest,
  sendBuilderDsiMessage,
  startBuilderDsiSession,
} from "./builder-dsi-authoring.js";

const session = {
  sessionId: "session-example",
  designSystemId: "system-example",
  projectId: "project-example",
  branchName: "branch-example",
  status: "ready",
  workspace: {
    sessionId: "codegen-example",
    revision: "revision-example",
    status: "idle",
    artifacts: [],
    messages: [],
  },
};
const start = {
  requestId: "request-example",
  title: "Example system",
  intent: "fresh" as const,
  prompt: "Create a high-contrast editorial system.",
  sources: [],
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  access.mockReset().mockResolvedValue({ status: "ready" });
  auth.mockReset().mockResolvedValue({
    source: "oauth",
    authorization: "Bearer example-test-token",
  });
  fetchMock.mockReset().mockResolvedValue(Response.json(session));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Builder native DSI transport", () => {
  it("checks personal access before resolving credentials or sending data", async () => {
    access.mockRejectedValue(new Error("Builder account required"));
    await expect(startBuilderDsiSession(start)).rejects.toThrow(
      "Builder account required",
    );
    expect(auth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, { source: "legacy", authorization: "example-private-key" }])(
    "does not use legacy credentials for the user-bound session API",
    async (credentials) => {
      auth.mockResolvedValue(credentials);
      await expect(startBuilderDsiSession(start)).rejects.toMatchObject({
        errorCode: "builder_dsi_oauth_required",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("starts through Builder with the same request ID and no invented references", async () => {
    expect(await startBuilderDsiSession(start)).toEqual(session);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://builder.example.test/design-systems/v1/authoring/start",
    );
    expect(options).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(options!.body as string)).toEqual(start);
    expect(auth).toHaveBeenCalledWith({
      requiredScope: "builder:designsystem:write",
    });
  });

  it("reads the exact saved session with read scope", async () => {
    await getBuilderDsiSession(session.sessionId);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "authoring/session?sessionId=session-example",
    );
    expect(auth).toHaveBeenCalledWith({
      requiredScope: "builder:designsystem:read",
    });
  });

  it("retains confirmed publication evidence on a read without republishing", async () => {
    const publication = {
      requestId: "publish-example",
      revision: "revision-example",
      published: 3,
    };
    fetchMock.mockResolvedValue(Response.json({ ...session, publication }));
    expect((await getBuilderDsiSession(session.sessionId)).publication).toEqual(
      publication,
    );
    expect(fetchMock.mock.calls[0][1]!.method).toBe("GET");
    fetchMock.mockResolvedValue(
      Response.json({
        ...session,
        publication: { ...publication, published: 0 },
      }),
    );
    await expect(getBuilderDsiSession(session.sessionId)).rejects.toMatchObject(
      {
        errorCode: "builder_dsi_response_invalid",
      },
    );
  });

  it("recovers an interrupted start by request ID without dispatching another mutation", async () => {
    expect(await readBuilderDsiSessionByRequest("start:example")).toEqual(
      session,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("requestId")).toBe(
      "start:example",
    );
    expect(init!.method).toBe("GET");
    expect(init!.body).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refines the same session, retaining target and revision", async () => {
    const input = {
      sessionId: session.sessionId,
      requestId: "turn-two",
      prompt: "Increase contrast.",
      targetId: "button.html",
      expectedRevision: "revision-example",
      sources: [{ kind: "file" as const, uploadToken: "example-upload-token" }],
    };
    await sendBuilderDsiMessage(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual(
      input,
    );
  });

  it("preserves typed Builder errors and their actionable messages", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          type: "error",
          code: "revision_conflict",
          message: "Read the latest revision before publishing.",
        },
        { status: 409 },
      ),
    );
    await expect(getBuilderDsiSession(session.sessionId)).rejects.toMatchObject(
      {
        errorCode: "builder_dsi_revision_conflict",
        message: "Read the latest revision before publishing.",
        details: { providerCode: "revision_conflict", providerStatus: 409 },
      },
    );
  });

  it("does not accept a source storage path in place of an owned upload token", async () => {
    await expect(
      sendBuilderDsiMessage({
        sessionId: session.sessionId,
        requestId: "source-turn",
        prompt: "Use these references.",
        sources: [{ kind: "file", uploadGcsPath: "untrusted-path" }] as never,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["network", "timeout"])(
    "does not resubmit an ambiguous %s mutation",
    async () => {
      fetchMock.mockRejectedValue(new Error("transport interrupted"));
      await expect(startBuilderDsiSession(start)).rejects.toMatchObject({
        errorCode: "builder_dsi_outcome_unknown",
        details: { outcome: "unknown", retryable: false },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 409, 503])(
    "keeps upstream %i errors visible without fallback",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: "Example access failure" }, { status }),
      );
      await expect(
        getBuilderDsiSession(session.sessionId),
      ).rejects.toMatchObject({ statusCode: status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{}, { ...session, sessionId: "another-session" }])(
    "rejects malformed or mismatched session output",
    async (value) => {
      fetchMock.mockResolvedValue(Response.json(value));
      await expect(
        getBuilderDsiSession(session.sessionId),
      ).rejects.toMatchObject({ errorCode: "builder_dsi_response_invalid" });
    },
  );

  it("rejects a truncated JSON stream", async () => {
    fetchMock.mockResolvedValue(new Response('{"sessionId":'));
    await expect(getBuilderDsiSession(session.sessionId)).rejects.toMatchObject(
      { errorCode: "builder_dsi_response_invalid" },
    );
  });

  it("rejects oversized output rather than truncating it into a successful artifact", async () => {
    fetchMock.mockResolvedValue(new Response(" ".repeat(4 * 1024 * 1024 + 1)));
    await expect(getBuilderDsiSession(session.sessionId)).rejects.toMatchObject(
      { errorCode: "builder_dsi_response_invalid" },
    );
  });

  it("returns real artifact bytes only for the requested identity and revision", async () => {
    const artifact = {
      id: "button.html",
      hash: "hash-example",
      contentType: "text/html",
      body: "<button>Example</button>",
    };
    fetchMock.mockResolvedValue(Response.json(artifact));
    expect(
      await readBuilderDsiArtifact({
        sessionId: session.sessionId,
        artifactId: artifact.id,
        revision: artifact.hash,
      }),
    ).toEqual(artifact);
    fetchMock.mockResolvedValue(
      Response.json({ ...artifact, hash: "changed" }),
    );
    await expect(
      readBuilderDsiArtifact({
        sessionId: session.sessionId,
        artifactId: artifact.id,
        revision: artifact.hash,
      }),
    ).rejects.toMatchObject({ errorCode: "builder_dsi_response_invalid" });
  });

  it("requires a nonempty publication receipt for the expected revision", async () => {
    const input = {
      sessionId: session.sessionId,
      requestId: "publish-example",
      expectedRevision: "revision-example",
    };
    const receipt = {
      sessionId: session.sessionId,
      revision: "revision-example",
      published: 4,
    };
    fetchMock.mockResolvedValue(Response.json(receipt));
    expect(await publishBuilderDsiSession(input)).toEqual(receipt);
    fetchMock.mockResolvedValue(Response.json({ ...receipt, published: 0 }));
    await expect(publishBuilderDsiSession(input)).rejects.toMatchObject({
      errorCode: "builder_dsi_response_invalid",
    });
  });
});
