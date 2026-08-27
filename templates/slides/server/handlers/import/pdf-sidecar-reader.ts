import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  isSlidesPdfSidecar,
  SLIDES_PDF_SIDECAR_MAX_JSON_BYTES,
  SLIDES_PDF_SIDECAR_NAMESPACE,
  type SlidesPdfSidecar,
} from "../../../shared/pdf-sidecar.js";

/**
 * Three outcomes, deliberately distinct: `absent` is a foreign PDF and must
 * fall through to `parsePdfFidelity`; `unreadable` is our own marker with a
 * payload we could not trust, which the caller has to report rather than
 * silently downgrade to a page-image import; `found` restores the deck.
 */
export type SlidesPdfSidecarResult =
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "found"; sidecar: SlidesPdfSidecar };

/**
 * jsPDF's XMP writer wraps the payload in a fixed `jspdf:metadata` element and
 * puts our namespace on the surrounding `rdf:Description`, so both have to be
 * present before the base64 inside is ours.
 */
const OPEN_TAG = "<jspdf:metadata>";
const CLOSE_TAG = "</jspdf:metadata>";

/** Reads the deck source an earlier Slides PDF export stamped into this document. */
export async function readSlidesPdfSidecar(
  doc: PDFDocumentProxy,
): Promise<SlidesPdfSidecarResult> {
  let raw: string;
  try {
    const { metadata } = await doc.getMetadata();
    const rawValue: unknown = metadata?.getRaw();
    if (typeof rawValue !== "string" || !rawValue) return { status: "absent" };
    raw = rawValue;
  } catch (err) {
    // pdfjs skips a metadata stream it cannot parse. That tells us nothing
    // about whether a sidecar was there, so this is "no sidecar", not "broken
    // sidecar" — fidelity parsing is the right next step either way.
    console.warn(
      "[import-file] PDF metadata could not be read, importing with fidelity parsing:",
      err instanceof Error ? err.message : String(err),
    );
    return { status: "absent" };
  }

  if (!raw.includes(SLIDES_PDF_SIDECAR_NAMESPACE)) return { status: "absent" };

  // Located by index rather than a lazy regex: `<jspdf:metadata>([\s\S]*?)</…>`
  // rescans to the end of the string from every opening tag, so a crafted XMP
  // full of openers costs quadratic time on a server thread.
  const open = raw.indexOf(OPEN_TAG);
  const close = open < 0 ? -1 : raw.indexOf(CLOSE_TAG, open + OPEN_TAG.length);
  if (open < 0 || close < 0) {
    return {
      status: "unreadable",
      reason: "the Slides namespace is present but carries no payload element",
    };
  }
  const payload = raw.slice(open + OPEN_TAG.length, close);

  // The exporter refuses to write more than this; a larger payload did not come
  // from a Slides export, and decoding it would allocate several copies of an
  // attacker-chosen size before any validation could reject it.
  if (payload.length > SLIDES_PDF_SIDECAR_MAX_JSON_BYTES * 2) {
    return {
      status: "unreadable",
      reason: `payload is ${payload.length} bytes, past anything this app writes`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch (err) {
    return {
      status: "unreadable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (!isSlidesPdfSidecar(parsed)) {
    return {
      status: "unreadable",
      reason: "payload is not a deck sidecar this version understands",
    };
  }
  if (parsed.slides.length === 0) {
    return { status: "unreadable", reason: "payload carries no slides" };
  }
  // The sidecar is one document-level stream, so it survives page edits made in
  // another PDF tool. Restoring 20 original slides from a file the user has
  // since cut to 17 pages would hand back a deck that does not match the
  // document in front of them; parse the pages they actually have instead.
  if (parsed.slides.length !== doc.numPages) {
    return {
      status: "unreadable",
      reason: `carries ${parsed.slides.length} slides but the PDF has ${doc.numPages} pages, so its pages were edited elsewhere`,
    };
  }

  return { status: "found", sidecar: parsed };
}
