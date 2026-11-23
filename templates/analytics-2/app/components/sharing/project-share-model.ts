import { projectPublicUrl } from "../projects/projectList";

/**
 * Row 599 (P1): what the project Share panel shows and what Copy link copies.
 *
 * Kept headless so the rules are testable without a browser: which rows appear,
 * in what order, how a missing name is shown, and the exact link text. The
 * component only renders this.
 */

export type ProjectShareGrant = {
  id: string;
  principalType: string;
  principalId: string;
  displayName?: string | null | undefined;
  role: string;
  agent?: boolean | undefined;
};

export type ProjectShareRow = {
  /** Stable key for React. */
  id: string;
  /** What the reader sees: a name when there is one, the identity otherwise. */
  label: string;
  /** Exactly "(Owner)" on the owner row, per the source's access rows. */
  owner: boolean;
};

/**
 * The owner first, then each grant in the order the server returned it. A grant
 * with no display name falls back to its identity rather than to a blank row.
 */
export function projectShareRows(input: {
  ownerEmail: string;
  ownerDisplayName?: string | null | undefined;
  shares: readonly ProjectShareGrant[];
}): ProjectShareRow[] {
  const ownerLabel = input.ownerDisplayName?.trim() || input.ownerEmail.trim();
  const rows: ProjectShareRow[] = ownerLabel
    ? [{ id: "owner", label: ownerLabel, owner: true }]
    : [];
  for (const share of input.shares) {
    const label = share.displayName?.trim() || share.principalId.trim();
    if (!label) continue;
    rows.push({ id: share.id, label, owner: false });
  }
  return rows;
}

/** The link Copy link puts on the clipboard: the project's canonical URL. */
export function projectShareLink(
  origin: string,
  projectId: string,
  basePath: string,
): string {
  return projectPublicUrl(projectId, origin, basePath);
}

/**
 * The panel's status line. Reading permissions, a failed read and an empty
 * grant list are different states, and the source names them differently.
 */
export type ProjectShareStatus =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "copied" }
  | { kind: "copy-failed" }
  | { kind: "ready" };

export function projectShareStatusText(
  status: ProjectShareStatus,
): string | null {
  switch (status.kind) {
    case "loading":
      return "Loading…";
    case "error":
      return "Failed to load permissions";
    case "copied":
      return "Link copied";
    case "copy-failed":
      return "Could not copy the link";
    case "ready":
      return null;
  }
}
