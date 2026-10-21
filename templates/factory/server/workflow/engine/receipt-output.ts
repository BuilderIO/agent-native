import { WORKFLOW_STORE_LIMITS } from "../adapter.js";
import { jsonByteLength } from "../items.js";
import { identifiesAThing, isIdentifierValue } from "../receipt-fields.js";
import { isRecord } from "./bounds.js";

interface Kept {
  output: Record<string, unknown>;
  /** Something in the response was left out. */
  cut: boolean;
}

/**
 * The identifying fields of a response, each a primitive or a list of them. A
 * list keeps its leading run: dropping one in the middle would move the rest to
 * other positions.
 */
function identifying(response: Record<string, unknown>): Kept {
  const output: Record<string, unknown> = {};
  let cut = false;
  for (const [key, value] of Object.entries(response)) {
    if (value === undefined) continue;
    if (!identifiesAThing(key)) {
      cut = true;
    } else if (isIdentifierValue(value)) {
      output[key] = value;
    } else if (Array.isArray(value)) {
      const leading = value.findIndex((entry) => !isIdentifierValue(entry));
      output[key] = leading === -1 ? value : value.slice(0, leading);
      cut ||= leading !== -1;
    } else {
      cut = true;
    }
  }
  return { output, cut };
}

interface BoundedOutput {
  output: Record<string, unknown>;
  /** What was kept is only part of the response. */
  truncated: boolean;
}

/**
 * The part of a write's response a receipt keeps, so a run that finds the
 * write already done can hand the next nodes what the first run did (a Slack
 * post's channel and message time are what a reply Wait watches). Only fields
 * named for what they identify are kept (`IDENTIFYING_KEYS`), and only as
 * primitives or lists of them. If what is left still does not fit, whole
 * fields stay, smallest first. `truncated` says whenever anything was left
 * out. A response that is not an object has no named field to keep. No response
 * keeps nothing.
 */
export function boundReceiptOutput(output: unknown): BoundedOutput | undefined {
  if (output === undefined || output === null) return undefined;
  if (!isRecord(output)) return { output: {}, truncated: true };
  const kept = identifying(output);
  const max = WORKFLOW_STORE_LIMITS.receiptOutputBytes;
  if (jsonByteLength(kept.output) <= max) {
    return { output: kept.output, truncated: kept.cut };
  }

  const fields = Object.entries(kept.output).map(([key, value], index) => ({
    key,
    index,
    // `"key":value`, as it stands inside an object.
    bytes: jsonByteLength(key) + 1 + jsonByteLength(value),
  }));
  const keep = new Set<string>();
  let used = 2;
  for (const field of [...fields].sort(
    (a, b) => a.bytes - b.bytes || a.index - b.index,
  )) {
    const next = used + field.bytes + (keep.size > 0 ? 1 : 0);
    if (next > max) continue;
    keep.add(field.key);
    used = next;
  }
  return {
    output: Object.fromEntries(
      Object.entries(kept.output).filter(([key]) => keep.has(key)),
    ),
    truncated: true,
  };
}
