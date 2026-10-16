import { expect, test, type Page } from "@playwright/test";

import { ACTION_HEADERS, postAction } from "./helpers";

// Decision D2 of the stored-form rebuild: a page takes the new body paths only
// when both flags are on for the person and the page itself is switched.
// Turning the shadow flag on alone measures parity and must not switch anyone.
export const SHADOW_FLAG = "content.live-body-shadow";
export const WRITER_FLAG = "content.live-body-writer";

export type GateArm = "off" | "on";

function readArm(): GateArm {
  const raw = process.env.CONTENT_LIVE_BODY_GATE ?? "off";
  if (raw === "off" || raw === "on") return raw;
  throw new Error(
    `CONTENT_LIVE_BODY_GATE must be "off" or "on", not ${JSON.stringify(raw)}.`,
  );
}

/** Which side of the D2 gate this run checks: CI runs the lane once per arm. */
export const GATE_ARM: GateArm = readArm();

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

// L3 owns the per-page switch inside the D2 gate. Until it lands, a page cannot
// be switched, so the gate-on arm has nothing to check.
async function switchPage(
  _page: Page,
  _documentId: string | null,
): Promise<void> {
  test.skip(
    true,
    "Gate on: the D2 per-page switch is not wired into e2e/live-body-gate.ts yet. L3 adds it.",
  );
}
