import { WorkflowError } from "../workflow/contract.js";
import { utf8ByteLength } from "../workflow/items.js";
import { invalidRecord } from "../workflow/store-rules.js";

export const MAX_ITEM_PAYLOAD_BYTES = 8 * 1024;
const MAX_TEXT_REF_CHARS = 500;

/**
 * The JSON for `factory_items.payload_json`: the provider's own fields for an
 * item, bounded to 8 KB. Over the cap is rejected with `output_over_cap`, so a
 * writer trims first and records `payloadTruncated`; nothing is cut here.
 */
export function serializeItemPayload(
  payload: Record<string, unknown> | undefined,
): string {
  if (payload === undefined) return "{}";
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidRecord("An item payload is a JSON object.");
  }
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    throw invalidRecord("An item payload cannot be stored as JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const bytes = utf8ByteLength(json);
  if (bytes > MAX_ITEM_PAYLOAD_BYTES) {
    throw new WorkflowError(
      "output_over_cap",
      `Item payload is ${bytes} bytes; the cap is ${MAX_ITEM_PAYLOAD_BYTES}.`,
      { bytes, maxBytes: MAX_ITEM_PAYLOAD_BYTES },
    );
  }
  return json;
}

/**
 * The handle for `factory_items.text_ref`: where a large body lives in blob
 * storage. A `data:` URL is the body itself, so it is refused.
 */
export function serializeTextRef(ref: string): string {
  if (ref.length === 0 || ref.length > MAX_TEXT_REF_CHARS) {
    throw invalidRecord(
      `A text reference is 1 to ${MAX_TEXT_REF_CHARS} characters.`,
      { length: ref.length },
    );
  }
  if (/^data:/i.test(ref)) {
    throw invalidRecord(
      "A text reference points at blob storage; it cannot be a data: URL.",
    );
  }
  return ref;
}
