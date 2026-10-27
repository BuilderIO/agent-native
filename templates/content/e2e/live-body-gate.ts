import { expect, test, type Page } from "@playwright/test";

import { knownLossSpec, type KnownLoss } from "../acceptance/known-loss";
import { GATE_ARM, type GateArm } from "./gate-arm";
import { ACTION_HEADERS, postAction, postUiAction } from "./helpers";

export { GATE_ARM, type GateArm };

// Decision D2 of the stored-form rebuild: a page takes the new body paths only
// when both flags are on for the person and the page itself is switched.
// Turning the shadow flag on alone measures parity and must not switch anyone.
export const SHADOW_FLAG = "content.live-body-shadow";
export const WRITER_FLAG = "content.live-body-writer";

/**
 * Known-loss details for a check main fails differently on each arm. Only this
 * run's arm entry tags it, so a lane whose fix flips one arm deletes that entry
 * and the check turns required there while the other arm keeps reporting.
 */
export function knownLossOnArm(losses: Partial<Record<GateArm, KnownLoss>>) {
  const loss = losses[GATE_ARM];
  return loss ? knownLossSpec(loss) : {};
}

/** The flag values the signed-in account gets, keyed by registered flag. */
async function flagValues(page: Page): Promise<Record<string, boolean>> {
  const response = await page.request.get(
    "/_agent-native/actions/get-feature-flags",
    { headers: ACTION_HEADERS },
  );
  const text = await response.text();
  expect(
    response.ok(),
    `get-feature-flags (${response.status()}): ${text}`,
  ).toBe(true);
  return JSON.parse(text) as Record<string, boolean>;
}

/**
 * Put a page this test just created on its run's side of the gate; pass null
 * when the test creates its page through the UI. The off arm proves neither
 * flag reaches the account; the on arm skips, with the reason, until the build
 * has everything the gate needs, and never passes in its place.
 */
export async function enterGateArm(
  page: Page,
  documentId: string | null,
): Promise<void> {
  const flags = await flagValues(page);
  if (GATE_ARM === "off") {
    for (const key of [SHADOW_FLAG, WRITER_FLAG])
      expect(flags[key], `${key} is on in the gate-off arm`).not.toBe(true);
    return;
  }
  if (!(WRITER_FLAG in flags))
    test.skip(
      true,
      `Gate on: this build registers no ${WRITER_FLAG} flag. L3 adds it with the D2 per-page switch.`,
    );
  for (const key of [SHADOW_FLAG, WRITER_FLAG])
    await postAction(page, "set-feature-flag", {
      operation: "enable-for-current-user",
      key,
    });
  const enabled = await flagValues(page);
  for (const key of [SHADOW_FLAG, WRITER_FLAG])
    expect(enabled[key], `${key} after enabling it for this account`).toBe(
      true,
    );
  await switchPage(page, documentId);
}

interface FlagRules {
  mode: "off" | "on" | "rules";
  emails: string[];
  orgIds: string[];
  percentage: number;
}

/**
 * Take the signed-in account back off both gate flags. enterGateArm adds the
 * account's email to each flag's rules in its organization, and that entry
 * outlives the run, so a later gate-off run signed in as the same account
 * would find the flags on. Other entries in the rules stay as they are.
 */
export async function leaveGateArm(
  page: Page,
  baseURL?: string,
): Promise<void> {
  if (GATE_ARM !== "on") return;
  const session = await page.request.get("/_agent-native/auth/session", {
    headers: { Accept: "application/json" },
  });
  const email = ((await session.json()) as { email?: string }).email
    ?.trim()
    .toLowerCase();
  if (!email)
    throw new Error(
      `Leaving the gate-on arm: no signed-in account (session ${session.status()}).`,
    );
  const response = await page.request.get(
    "/_agent-native/actions/list-feature-flags",
    { headers: ACTION_HEADERS },
  );
  const text = await response.text();
  if (!response.ok())
    throw new Error(`list-feature-flags (${response.status()}): ${text}`);
  const listed = JSON.parse(text) as {
    status: string;
    flags: { key: string; rules: FlagRules }[];
  };
  // set-feature-flag needs the same permission, so an account that cannot
  // list the flags never enabled them.
  if (listed.status === "forbidden") return;
  for (const flag of listed.flags) {
    if (flag.key !== SHADOW_FLAG && flag.key !== WRITER_FLAG) continue;
    if (!flag.rules.emails.includes(email)) continue;
    const { mode, emails, orgIds, percentage } = flag.rules;
    await postAction(
      page,
      "set-feature-flag",
      {
        operation: "replace-rules",
        key: flag.key,
        rules: {
          mode,
          emails: emails.filter((entry) => entry !== email),
          orgIds,
          percentage,
        },
      },
      ACTION_HEADERS,
      baseURL,
    );
  }
  const left = await flagValues(page);
  for (const key of [SHADOW_FLAG, WRITER_FLAG])
    if (left[key] === true)
      throw new Error(
        `${key} is still on for ${email} after leaving the gate-on arm, so its rules turn it on for more than this account.`,
      );
}

const SWITCH_ACTION = "set-live-body-switch";

/**
 * Switch the page through L3's action, then require both the switch and
 * get-document to say the page writes through its live copy. A build that has
 * the switch before its writers are routed answers "legacy", and a gate-on
 * scenario run there would pass on the old path, so the arm skips instead.
 */
async function switchPage(
  page: Page,
  documentId: string | null,
): Promise<void> {
  if (documentId === null)
    test.skip(
      true,
      "Gate on: this test creates its page through the UI, and only a page that exists can be switched.",
    );
  const response = await postUiAction(page, SWITCH_ACTION, {
    id: documentId,
    switched: true,
  });
  const text = await response.text();
  if (response.status() === 404 && text.includes("Cannot find any route"))
    test.skip(
      true,
      `Gate on: this build has no ${SWITCH_ACTION} action. L3 adds it with conversion of the page's live copy.`,
    );
  expect(
    response.ok(),
    `${SWITCH_ACTION} (${response.status()}): ${text}`,
  ).toBe(true);
  const switched = JSON.parse(text) as { writePath?: string; reason?: string };
  if (switched.writePath !== "live_copy")
    test.skip(
      true,
      `Gate on: ${SWITCH_ACTION} left the page on the ${switched.writePath ?? "unreported"} write path${switched.reason ? ` (${switched.reason})` : ""}.`,
    );
  const read = await page.request.get("/_agent-native/actions/get-document", {
    params: { id: documentId! },
    headers: ACTION_HEADERS,
  });
  const readText = await read.text();
  expect(read.ok(), `get-document (${read.status()}): ${readText}`).toBe(true);
  const { writePath } = JSON.parse(readText) as { writePath?: string };
  if (writePath === undefined)
    test.skip(
      true,
      "Gate on: get-document does not report writePath yet, so the arm cannot confirm the page writes through its live copy.",
    );
  expect(
    writePath,
    `${SWITCH_ACTION} said live_copy, but get-document says otherwise`,
  ).toBe("live_copy");
}
