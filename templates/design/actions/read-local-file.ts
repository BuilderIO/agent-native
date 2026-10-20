/**
 * read-local-file — read one file from a connected local app via the design
 * bridge.
 *
 * Security gates (in order), mirroring write-local-file.ts minus the write
 * grant (reads do not require user write consent, only editor access + a
 * valid bridge connection):
 *  1. assertAccess: the caller must have editor access to the design.
 *  2. Bridge URL resolution: only the current user's own connection row, in
 *     the caller's own org scope. A miss throws a classified 4xx from
 *     server/lib/localhost-connection.ts so the client sees the actual
 *     condition instead of a generic 500.
 *  3. Loopback check: bridgeUrl must resolve to localhost/127.0.0.1.
 *  4. Bridge token: the connection's stored bridge token is sent as
 *     X-Bridge-Token so the bridge can reject unauthorized callers. The
 *     bridge itself additionally blocks secret-looking paths (.env*, *.pem,
 *     *.key, id_rsa*, anything under .git/) regardless of this grant.
 */

import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  fetchLocalhostBridge,
  localhostBridgeRequestError,
  requireLocalhostBridgeToken,
  resolveLocalhostBridgeConnection,
  resolveLocalhostConnectionScope,
} from "../server/lib/localhost-connection.js";
import {
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";
import {
  MotionLocalSourceError,
  resolveMotionLocalSourceLocation,
  resolveMotionLocalSourceRoute,
} from "./_motion-local-source.js";
import {
  localhostBridgeRelayStep,
  verifyLocalhostBridgeReceipt,
} from "./motion-localhost-relay.js";
import {
  createLocalhostBridgeRelay,
  issueLocalhostBridgeChallenge,
  isLocalhostBridgeRelayRequest,
} from "./visual-edit-browser-request.js";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const parts = normalized.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  );
}

function normalizeBridgeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("bridgeUrl must be an http(s) URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("bridgeUrl must not include credentials");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("bridgeUrl must not include a path");
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error("bridgeUrl must use localhost or a loopback IP address");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

export default defineAction({
  description:
    "Read one file's content from a connected local app via the localhost " +
    "design bridge. Read-only — does not require a write-consent grant, but " +
    "does require editor access on the design and a running bridge " +
    "connection. The bridge blocks secret-looking paths (.env*, *.pem, " +
    "*.key, id_rsa*, anything under .git/) even for callers with editor access.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z.string().describe("Localhost connection ID."),
    path: z
      .string()
      .describe("Path to the file relative to the connection rootPath."),
    motionScreenId: z
      .string()
      .optional()
      .describe(
        "Internal Motion provenance check rooted at this saved screen.",
      ),
  }),
  readOnly: true,
  capabilityScopes: ["visual-edit"],
  http: { method: "GET" },
  run: async (
    { designId, connectionId, path: relPath, motionScreenId },
    ctx,
  ) => {
    await assertAccess("design", designId, "editor");

    const scope = await resolveLocalhostConnectionScope({ designId });
    const connection = await resolveLocalhostBridgeConnection({
      connectionId,
      ...scope,
    });
    const bridgeToken = requireLocalhostBridgeToken(
      connectionId,
      connection.bridgeToken,
    );

    const bridgeUrl = normalizeBridgeUrl(connection.bridgeUrl);
    if (motionScreenId !== undefined) {
      const [design] = await getDb()
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);
      if (!design) {
        fail("The selected localhost screen is not part of this Design.", {
          errorCode: "motion_local_source_screen_not_found",
          statusCode: 404,
        });
      }

      let route: ReturnType<typeof resolveMotionLocalSourceRoute>;
      try {
        const location = resolveMotionLocalSourceLocation({
          designData: design.data,
          screenId: motionScreenId,
          declaration: { connectionId, filePath: relPath },
        });
        route = resolveMotionLocalSourceRoute({
          designData: design.data,
          screenId: motionScreenId,
          declarationConnectionId: connectionId,
        });
        if (location.filePath !== relPath) {
          throw new MotionLocalSourceError(
            "source-metadata-mismatch",
            "The requested React source does not match the selected screen.",
          );
        }
      } catch (error) {
        if (error instanceof MotionLocalSourceError) {
          fail(error.message, {
            errorCode: `motion_local_source_${error.code.replace(/-/g, "_")}`,
            statusCode: 422,
          });
        }
        throw error;
      }

      const step = localhostBridgeRelayStep(ctx) ?? "source-provenance";
      if (isLocalhostBridgeRelayRequest(ctx)) {
        return createLocalhostBridgeRelay({
          relay: {
            operation: "verify-module-provenance",
            designId,
            connectionId,
            step,
            path: route.sourceFile,
            relPath,
          },
          context: ctx,
          bridgeToken,
          rootPath: connection.rootPath,
          bridgeRequest: {
            routePath: route.sourceFile,
            modulePath: relPath,
          },
        });
      }

      const relay: LocalhostBridgeRelay = {
        __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
        operation: "verify-module-provenance" as const,
        designId,
        connectionId,
        step,
        path: route.sourceFile,
        relPath,
      };
      const challenge = issueLocalhostBridgeChallenge(relay);
      relay.challenge = challenge;
      const res = await fetchLocalhostBridge({
        bridgeUrl,
        operation: "verify-module-provenance",
        bridgeToken,
        body: {
          routePath: route.sourceFile,
          modulePath: relPath,
          motionRelayChallenge: challenge,
        },
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw localhostBridgeRequestError(
          "verify-module-provenance",
          res.status,
          errText,
        );
      }
      const body = (await res.json().catch(() => undefined)) as
        | Record<string, unknown>
        | undefined;
      if (
        !body ||
        body.routePath !== route.sourceFile ||
        body.modulePath !== relPath ||
        typeof body.reachable !== "boolean" ||
        !(await verifyLocalhostBridgeReceipt(relay, {
          ...body,
          designId,
          connectionId,
        }))
      ) {
        fail("The localhost bridge could not authenticate source provenance.", {
          errorCode: "motion_local_source_provenance_unverified",
          statusCode: 502,
        });
      }
      if (!body.reachable) {
        fail("The requested module is not imported by the selected screen.", {
          errorCode: "motion_local_source_module_not_imported",
          statusCode: 422,
        });
      }
      return {
        designId,
        connectionId,
        routePath: route.sourceFile,
        modulePath: relPath,
        reachable: body.reachable,
        operationReceipt: body.operationReceipt,
      };
    }

    if (isLocalhostBridgeRelayRequest(ctx)) {
      const step = localhostBridgeRelayStep(ctx);
      return createLocalhostBridgeRelay({
        relay: {
          operation: "read-file",
          designId,
          connectionId,
          path: relPath,
          ...(step ? { step } : {}),
        },
        context: ctx,
        bridgeToken,
        rootPath: connection.rootPath,
        bridgeRequest: { relPath },
      });
    }

    const res = await fetchLocalhostBridge({
      bridgeUrl,
      operation: "read-file",
      bridgeToken,
      body: { relPath },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw localhostBridgeRequestError("read-file", res.status, errText);
    }
    const body = (await res.json().catch(() => undefined)) as
      | { content?: unknown; versionHash?: unknown }
      | undefined;
    if (
      !body ||
      typeof body.content !== "string" ||
      typeof body.versionHash !== "string"
    ) {
      throw localhostBridgeRequestError(
        "read-file",
        502,
        "invalid response; expected string content and versionHash",
      );
    }

    return {
      designId,
      connectionId,
      path: relPath,
      content: body.content,
      versionHash: body.versionHash,
      readonly: false,
    };
  },
});
