import crypto from "node:crypto";

import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  deleteSettingIfValue,
  getSetting,
  putSetting,
} from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { isLocalVisualEditPrincipal } from "../../shared/local-visual-edit-principal.js";
import { getDb, schema } from "../db/index.js";
import {
  designDataForAccessRole,
  markVisualEditBoardClaimed,
  VISUAL_EDIT_BOARD_DATA_KEY,
} from "./design-data-access.js";
import { firstRow } from "./visual-edit-capability.js";

// Settings never reach viewers, unlike design data, so the claim hash lives
// here and never in anything get-design or a snapshot can return.
const CLAIM_SETTING_PREFIX = "design-visual-edit-board-claim:";
const CLAIM_RACE_REREADS = 10;
const CLAIM_RACE_REREAD_DELAY_MS = 50;

function claimSettingKey(designId: string): string {
  return `${CLAIM_SETTING_PREFIX}${designId}`;
}

function hashClaimSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function parseDesignData(raw: string | null | undefined) {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Design data is not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Mark a design `open-visual-edit` just created, and open it publicly. */
export async function markVisualEditBoard(
  designId: string,
  makePublic: boolean,
): Promise<void> {
  await assertAccess("design", designId, "editor");
  const db = getDb();
  const rows = await db
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(eq(schema.designs.id, designId))
    .limit(1);
  const design = firstRow(rows);
  if (!design) throw new Error(`Design "${designId}" not found.`);
  const data = parseDesignData(design.data);
  await db
    .update(schema.designs)
    .set({
      data: JSON.stringify({ ...data, [VISUAL_EDIT_BOARD_DATA_KEY]: true }),
      ...(makePublic ? { visibility: "public" as const } : {}),
    })
    .where(eq(schema.designs.id, designId));
}

/**
 * Mint the one secret that can move a signed-out board into an account. Only
 * its hash is stored; the caller hands the secret to the page that opened the
 * board and to no one else. Returns undefined for a signed-in creator, whose
 * board is already in their account.
 */
export async function issueVisualEditBoardClaim(
  designId: string,
): Promise<string | undefined> {
  if (!isLocalVisualEditPrincipal(getRequestUserEmail())) return undefined;
  const secret = crypto.randomBytes(32).toString("base64url");
  await putSetting(claimSettingKey(designId), {
    hash: hashClaimSecret(secret),
    createdAt: new Date().toISOString(),
  });
  return secret;
}

function claimHashMatches(stored: unknown, secret: string): boolean {
  if (typeof stored !== "string" || !/^[a-f0-9]{64}$/.test(stored)) {
    return false;
  }
  const expected = Buffer.from(stored, "hex");
  const actual = Buffer.from(hashClaimSecret(secret), "hex");
  return crypto.timingSafeEqual(expected, actual);
}

export interface VisualEditBoardClaimResult {
  designId: string;
  claimed: true;
  alreadyOwned: boolean;
}

/**
 * Move a signed-out board into the signed-in caller's account. The secret is
 * single-use and the owner change is a compare-and-set on the local principal,
 * so concurrent or replayed claims cannot hand the board to two accounts.
 */
export async function claimVisualEditBoard(args: {
  designId: string;
  claimSecret: string;
  userEmail: string;
  orgId: string | null;
}): Promise<VisualEditBoardClaimResult> {
  const { designId, claimSecret, userEmail, orgId } = args;
  if (isLocalVisualEditPrincipal(userEmail)) {
    fail("Sign in to save this board to your account.", {
      errorCode: "visual_edit_board_claim_requires_account",
      statusCode: 401,
    });
  }
  const db = getDb();
  // The caller has no access to the board yet: the claim secret, checked
  // below, is the authorization for these reads and the owner change.
  const readDesign = async () => {
    // guard:allow-unscoped — authorized by the claim secret, not by ownership
    const rows = await db
      .select({
        ownerEmail: schema.designs.ownerEmail,
        data: schema.designs.data,
      })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    const design = firstRow(rows);
    return design;
  };
  const sameUser = (email: string) =>
    email.trim().toLowerCase() === userEmail.trim().toLowerCase();
  const notClaimable = (): never =>
    fail("This board cannot be claimed.", {
      errorCode: "visual_edit_board_not_claimable",
      statusCode: 403,
    });

  const design = await readDesign();
  if (!design) return notClaimable();
  if (sameUser(design.ownerEmail)) {
    return { designId, claimed: true, alreadyOwned: true };
  }
  if (!isLocalVisualEditPrincipal(design.ownerEmail)) return notClaimable();

  const key = claimSettingKey(designId);
  const stored = await getSetting(key);
  if (!stored || !claimHashMatches(stored.hash, claimSecret)) {
    return notClaimable();
  }
  // Consuming the secret first makes it single-use: of two racing claims,
  // only the one whose delete lands goes on to change the owner. A loser may
  // be the same account's other tab, whose winner is still moving the owner,
  // so it waits briefly for that before refusing.
  if (!(await deleteSettingIfValue(key, stored))) {
    for (let attempt = 0; attempt < CLAIM_RACE_REREADS; attempt += 1) {
      const current = await readDesign();
      if (current && sameUser(current.ownerEmail)) {
        return { designId, claimed: true, alreadyOwned: true };
      }
      if (!current || !isLocalVisualEditPrincipal(current.ownerEmail)) break;
      await new Promise((resolve) =>
        setTimeout(resolve, CLAIM_RACE_REREAD_DELAY_MS),
      );
    }
    return notClaimable();
  }

  const previousOwner = design.ownerEmail;
  try {
    await markVisualEditBoardClaimed(designId);
    const data = designDataForAccessRole(
      JSON.stringify(parseDesignData(design.data)),
      "viewer",
    );
    if (typeof data !== "string") {
      throw new Error("Board data could not be prepared for the new owner.");
    }
    // guard:allow-unscoped — compare-and-set on the local principal owner
    const updated = await db
      .update(schema.designs)
      .set({
        ownerEmail: userEmail,
        orgId,
        visibility: "private",
        liveCollaborationEnabled: false,
        data,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.designs.id, designId),
          eq(schema.designs.ownerEmail, previousOwner),
        ),
      )
      .returning({ id: schema.designs.id });
    if (updated.length === 1) {
      return { designId, claimed: true, alreadyOwned: false };
    }
  } catch (error) {
    await putSetting(key, stored);
    throw error;
  }
  const after = await readDesign();
  if (after && sameUser(after.ownerEmail)) {
    return { designId, claimed: true, alreadyOwned: true };
  }
  return notClaimable();
}
