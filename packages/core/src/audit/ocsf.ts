/**
 * Map an audit event to an OCSF API Activity event (class 6003, category 6
 * Application Activity) so a SIEM can ingest the trail.
 *
 * Pure: no I/O, no clock. Field names and enum values follow OCSF
 * {@link OCSF_SCHEMA_VERSION}. Anything OCSF has no field for (run, task,
 * thread, turn, app, lineage) goes under `unmapped` instead of an invented
 * field. The redacted `input` payload is never exported.
 */
import { parseServiceIdentityEmail } from "../org/service-identity.js";
import { redactTextToSummary } from "./redact.js";
import type { AuditEvent, AuditStatus } from "./types.js";

export const OCSF_SCHEMA_VERSION = "1.9.0";

const CLASS_UID = 6003;
const CATEGORY_UID = 6;

/** OCSF `activity_id`: 1 Create, 2 Read, 3 Update, 4 Delete, 99 Other. */
type OcsfActivityId = 1 | 2 | 3 | 4 | 99;

const ACTIVITY_NAMES: Record<OcsfActivityId, string> = {
  1: "Create",
  2: "Read",
  3: "Update",
  4: "Delete",
  99: "Other",
};

// Action names are verb-first kebab-case (`delete-recording`). A verb we do
// not recognise is `Other`, never a guess.
const ACTIVITY_VERBS: Array<[OcsfActivityId, RegExp]> = [
  [1, /^(create|add|new|invite|upload|import|register|mint|connect)(-|$)/],
  [2, /^(get|list|read|search|view|export|query|find|fetch)(-|$)/],
  [4, /^(delete|remove|revoke|archive|disconnect|retire|purge)(-|$)/],
  [
    3,
    /^(update|set|change|edit|rename|move|save|enable|disable|suspend|resume|toggle)(-|$)/,
  ],
];

function activityId(action: string): OcsfActivityId {
  const name = action.toLowerCase();
  return ACTIVITY_VERBS.find(([, verb]) => verb.test(name))?.[0] ?? 99;
}

// A refused attempt is the signal a SIEM alerts on, so it ranks above an
// internal error; both outrank a normal success.
const SEVERITY: Record<AuditStatus, 1 | 2 | 3> = {
  success: 1,
  error: 2,
  denied: 3,
};

function sanitizeLineageUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (/%(?:2f|5c)/i.test(url.pathname)) return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    let redactNextPathSegment = false;
    const safePath = url.pathname
      .split("/")
      .map((segment) => {
        if (redactNextPathSegment) {
          redactNextPathSegment = false;
          return "redacted";
        }
        let decoded = segment;
        try {
          decoded = decodeURIComponent(segment);
        } catch {
          return "redacted";
        }
        const pathKey = decoded.toLowerCase().replace(/[-_]/g, "");
        if (
          /^(?:apikey|accesstoken|refreshtoken|token|secret|password|credential|signature|sig|authorization|auth|session)$/.test(
            pathKey,
          )
        ) {
          redactNextPathSegment = true;
          return segment;
        }
        const redacted = redactTextToSummary(decoded);
        if (!redacted || redacted === decoded) return segment;
        return encodeURIComponent(
          redacted === "[redacted]" ? "redacted" : redacted,
        );
      })
      .join("/");
    const safeUrl = `${url.origin}${safePath === "/" ? "" : safePath}`;
    return redactTextToSummary(safeUrl) ?? undefined;
    // coercion-ok: malformed lineage URLs are omitted from the SIEM export.
  } catch {
    return undefined;
  }
}

function sanitizeNetworkPeer(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const url = sanitizeLineageUrl(trimmed);
  if (url) return url;
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(trimmed)) return undefined;
  return redactTextToSummary(trimmed) ?? undefined;
}

export interface OcsfApiActivity {
  class_uid: 6003;
  class_name: "API Activity";
  category_uid: 6;
  category_name: "Application Activity";
  activity_id: OcsfActivityId;
  activity_name: string;
  type_uid: number;
  type_name: string;
  /** Epoch milliseconds. */
  time: number;
  severity_id: 1 | 2 | 3;
  severity: "Informational" | "Low" | "Medium";
  status_id: 1 | 2;
  status: "Success" | "Failure";
  status_code?: string;
  status_detail?: string;
  /** 1 Allowed, 2 Denied. */
  action_id: 1 | 2;
  action: "Allowed" | "Denied";
  message: string;
  metadata: {
    version: string;
    uid: string;
    log_name: string;
    tenant_uid?: string;
    product: { name: string; vendor_name: string; uid?: string };
  };
  actor: {
    user: {
      uid?: string;
      name: string;
      email_addr?: string;
      /** 1 User, 3 System, 4 Service. */
      type_id: 1 | 3 | 4;
      type: "User" | "System" | "Service";
    };
    session?: { uid: string };
  };
  api: { operation: string; service?: { name: string } };
  src_endpoint: { name: string; uid?: string };
  resources?: Array<{
    type?: string;
    uid?: string;
    owner?: { email_addr: string };
  }>;
  unmapped: Record<string, string>;
}

function actorFor(event: AuditEvent): OcsfApiActivity["actor"] {
  const email = event.actorEmail;
  const service = parseServiceIdentityEmail(email);
  // A human can register a `@service.<orgId>` address, so the email alone is
  // not proof of a service principal: it must name this event's org.
  const session = event.threadId ? { session: { uid: event.threadId } } : {};
  if (service && email && event.orgId && service.orgId === event.orgId) {
    return {
      user: {
        uid: email,
        name: `svc-${service.serviceName}`,
        type_id: 4,
        type: "Service",
      },
      ...session,
    };
  }
  if (email) {
    return {
      user: {
        uid: email,
        name: email,
        email_addr: email,
        type_id: 1,
        type: "User",
      },
      ...session,
    };
  }
  return {
    user: { name: "system", type_id: 3, type: "System" },
    ...session,
  };
}

function statusDetail(event: AuditEvent): string | undefined {
  if (event.status === "denied") {
    return event.errorCode
      ? `Refused: ${event.errorCode}`
      : "Refused: the caller was not permitted to perform this action";
  }
  if (event.status === "error") {
    return event.errorCode ? `Failed: ${event.errorCode}` : "Failed";
  }
  return undefined;
}

export function auditEventToOcsf(event: AuditEvent): OcsfApiActivity {
  const id = activityId(event.action);
  const failed = event.status !== "success";
  const detail = statusDetail(event);
  const unmapped: Record<string, string> = {};
  const keep = (key: string, value: string | null | undefined) => {
    if (value) unmapped[key] = value;
  };
  keep("actor_kind", event.actorKind);
  keep("caller", event.caller);
  keep("app", event.app);
  keep("visibility", event.visibility);
  keep("thread_id", event.threadId);
  keep("turn_id", event.turnId);
  keep("run_id", event.runId);
  keep("task_id", event.taskId);
  keep("parent_task_id", event.parentTaskId);
  keep("source_kind", event.sourceKind);
  keep("source_platform", event.sourcePlatform);
  keep("source_id", event.sourceId);
  keep("source_url", sanitizeLineageUrl(event.sourceUrl));
  keep("network_protocol", event.networkProtocol);
  keep("network_id", event.networkId);
  const networkPeer = sanitizeNetworkPeer(event.networkPeer);
  keep("network_peer", networkPeer);

  const resource =
    event.targetType || event.targetId
      ? [
          {
            ...(event.targetType ? { type: event.targetType } : {}),
            ...(event.targetId ? { uid: event.targetId } : {}),
            ...(event.ownerEmail
              ? { owner: { email_addr: event.ownerEmail } }
              : {}),
          },
        ]
      : undefined;

  return {
    class_uid: CLASS_UID,
    class_name: "API Activity",
    category_uid: CATEGORY_UID,
    category_name: "Application Activity",
    activity_id: id,
    activity_name: ACTIVITY_NAMES[id],
    type_uid: CLASS_UID * 100 + id,
    type_name: `API Activity: ${ACTIVITY_NAMES[id]}`,
    time: event.createdAt,
    severity_id: SEVERITY[event.status],
    severity: (["Informational", "Low", "Medium"] as const)[
      SEVERITY[event.status] - 1
    ],
    status_id: failed ? 2 : 1,
    status: failed ? "Failure" : "Success",
    ...(event.errorCode ? { status_code: event.errorCode } : {}),
    ...(detail ? { status_detail: detail } : {}),
    action_id: event.status === "denied" ? 2 : 1,
    action: event.status === "denied" ? "Denied" : "Allowed",
    message: event.summary || `${event.action} (${event.status})`,
    metadata: {
      version: OCSF_SCHEMA_VERSION,
      uid: event.id,
      log_name: "agent_audit_log",
      ...(event.orgId ? { tenant_uid: event.orgId } : {}),
      product: {
        name: "Agent-Native",
        vendor_name: "Builder.io",
        ...(event.app ? { uid: event.app } : {}),
      },
    },
    actor: actorFor(event),
    api: {
      operation: event.action,
      ...(event.app ? { service: { name: event.app } } : {}),
    },
    src_endpoint: {
      name: networkPeer || event.caller,
      ...(event.networkId ? { uid: event.networkId } : {}),
    },
    ...(resource ? { resources: resource } : {}),
    unmapped,
  };
}
