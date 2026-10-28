/**
 * Opens the outcome of a data panel whose SQL ran and drew rows. A receipt
 * check is evidence of a live query only when its detail starts with this; a
 * section or extension panel's passing check has no data behind it. Kept in
 * its own file so the chat plugin can read it without loading the verifier.
 */
export const PANEL_RENDERED_PREFIX = "renders ";
