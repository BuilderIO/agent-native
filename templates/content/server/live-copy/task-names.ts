/** Content's own tasks in the live copy's bounded worker, beside core's. */
export const CONTENT_HOLDS_BODY_TASK = "content.holdsBody";

export type HoldsBodyResult = "held" | "unheld" | "noncanonical";
