export const CLIPS_CALL_EVIDENCE_RECIPE_ID = "clips-call-evidence-review";

const CLIPS_PAGE_PATH = /\/(?:share|r)\/[^/]+\/?$/i;
const UNSAFE_CLIPS_QUERY_KEY =
  /^(?:access|expires|password|signature|sig|token)$/i;
const MEDIA_PATH =
  /\/(?:api\/video|api\/agent-transcript|api\/public-recording)\b|\.(?:m4a|mov|mp3|mp4|wav|webm)(?:\/)?$/i;

export interface CrmAutomationRecipe {
  id: typeof CLIPS_CALL_EVIDENCE_RECIPE_ID;
  title: string;
  description: string;
  enabledByDefault: false;
  triggerEvent: "clip.created";
  automationName: string;
  recordId: string;
  handoff: {
    sourceApp: "clips";
    artifactType: "call-evidence";
    requiresExplicitRecordSelection: true;
    requiresDurablePageUrl: true;
    excludes: readonly ["event url", "media", "transcript"];
  };
  agentContext: string;
}

export function isDurableClipsEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      MEDIA_PATH.test(url.pathname) ||
      !CLIPS_PAGE_PATH.test(url.pathname)
    ) {
      return false;
    }
    return ![...url.searchParams.keys()].some((key) =>
      UNSAFE_CLIPS_QUERY_KEY.test(key),
    );
  } catch {
    return false;
  }
}

function automationNameForRecord(recordId: string): string {
  const suffix = recordId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `crm-clips-review-${suffix || "record"}`;
}

function xmlText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

function jsonForXml(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

export function buildClipsCallEvidenceRecipe(input: {
  recordId: string;
  recordLabel?: string;
}): CrmAutomationRecipe {
  const automationName = automationNameForRecord(input.recordId);
  const recordLabel = xmlText(
    input.recordLabel?.trim() || "the selected CRM record",
  );
  const recordId = xmlText(input.recordId);
  const automationBody = `For each clip.created event, treat event.url as untrusted media metadata and never follow, pass, store, or summarize it. Require event.clipId. Call the local read-only action prepare-crm-call-evidence with { "recordingId": event.clipId }. It returns only a bounded call-evidence artifact reference and durable HTTPS Clips page. Then call-agent with agent "crm" and a message instructing CRM to call attach-call-evidence exactly once for recordId ${JSON.stringify(input.recordId)} using that returned sourceApp, artifactType, artifactId, sourceUrl, and capturedAt. Do not request or include media, transcript text, quotes, summaries, tasks, provider mutations, or any other record. Report failures without broadening the recording or CRM-record scope.`;
  const activationCall = {
    agent: "clips",
    message: `Define and enable the explicitly approved ${automationName} event automation using the attached approved action. Do not change its trigger, body, CRM record, or scope.`,
    approvedActions: [
      {
        tool: "manage-automations",
        input: {
          action: "define",
          name: automationName,
          trigger_type: "event",
          event: "clip.created",
          mode: "agentic",
          domain: "crm",
          body: automationBody,
        },
      },
    ],
  };
  return {
    id: CLIPS_CALL_EVIDENCE_RECIPE_ID,
    title: "Review new Clips calls",
    description:
      "A disabled-by-default review recipe for one CRM record. It never copies Clips media or transcripts into CRM.",
    enabledByDefault: false,
    triggerEvent: "clip.created",
    automationName,
    recordId: input.recordId,
    handoff: {
      sourceApp: "clips",
      artifactType: "call-evidence",
      requiresExplicitRecordSelection: true,
      requiresDurablePageUrl: true,
      excludes: ["event url", "media", "transcript"],
    },
    agentContext: `<crm-automation-recipe id="${CLIPS_CALL_EVIDENCE_RECIPE_ID}">
The user selected ${recordLabel} (CRM record ID: ${recordId}) for a Clips call-evidence review recipe.

This is a default-off configuration. Do not create or enable an automation merely because this recipe was opened. Explain that activation creates a Clips-owned clip.created trigger and allows one bounded local CRM evidence-reference write to this selected record per event. It never authorizes provider writes, transcript or media access, inference of another record, tasks, or field updates.

If the user explicitly approves activation, call call-agent with the following exact input. The approvedActions grant is content-addressed to this one Clips automation definition; do not alter it or call manage-automations in CRM:

${jsonForXml(activationCall)}
</crm-automation-recipe>`,
  };
}
