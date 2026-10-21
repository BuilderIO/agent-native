import type { DataNote } from "./data-notes";

/**
 * Test fixtures from the Analytics annotations seed list, with internal
 * counts left out: the Oct 9–13 setup incident, the Connect-click
 * undercount, and the onboarding skips tracked from Sep 17.
 */
const base = {
  addedBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  unlessEvents: [],
  panels: [],
} satisfies Partial<DataNote>;

export const SETUP_INCIDENT: DataNote = {
  ...base,
  id: "note-setup-incident",
  kind: "incident",
  title: "Builder.io account setup failures",
  note: "Builder.io account setup failures surged Oct 9–13; a deploy on Oct 13 fixed it.",
  startDate: "2026-10-09",
  endDate: "2026-10-13",
  status: "fixed",
  fix: "A deploy on Oct 13.",
  matchEvents: ["builder_connect_failed"],
};

export const CONNECT_UNDERCOUNT: DataNote = {
  ...base,
  id: "note-connect-undercount",
  kind: "data",
  title: "Connect clicks undercounted",
  note: "From Oct 2, one-click Builder.io clicks were logged as builder_connect_clicked, so this chart misses them.",
  startDate: "2026-10-02",
  status: "open",
  matchEvents: ["builder connect clicked"],
  unlessEvents: ["builder_connect_clicked"],
};

export const SKIPS_UNTRACKED: DataNote = {
  ...base,
  id: "note-skips-untracked",
  kind: "data",
  title: "Onboarding step skips not tracked",
  note: "Skipped onboarding steps were not tracked before Sep 17, so skips are understated before then.",
  endDate: "2026-09-17",
  status: "fixed",
  matchEvents: ["onboarding_step_skipped"],
};
