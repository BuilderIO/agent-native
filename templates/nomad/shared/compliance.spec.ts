import { describe, expect, it } from "vitest";

import {
  addDays,
  applyVisaCap,
  computeMustExitBy,
  computeReEnterOn,
  computeRule,
  computeSnapshot,
  computeVisa,
  countDays,
  dayNumber,
  dateFromDayNumber,
  findCurrentLocation,
} from "./compliance";
import type { NomadProfile, Rule, Stay, Visa } from "./types";

const TODAY = "2026-07-20";

function stay(
  partial: Partial<Stay> & Pick<Stay, "countryCode" | "entryDate">,
): Stay {
  return {
    id: partial.id ?? `stay-${partial.countryCode}-${partial.entryDate}`,
    city: null,
    exitDate: null,
    source: "manual",
    status: "confirmed",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function visa(
  partial: Partial<Visa> & Pick<Visa, "label" | "expiresOn">,
): Visa {
  return {
    id: partial.id ?? partial.label,
    countryCode: null,
    zone: null,
    validFrom: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function rule(
  partial: Partial<Rule> & Pick<Rule, "name" | "kind" | "limitDays">,
): Rule {
  return {
    id: partial.id ?? partial.name,
    countryCode: null,
    zone: null,
    windowDays: null,
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const schengenRule = rule({
  name: "Schengen 90/180",
  kind: "rolling-window",
  zone: "schengen",
  limitDays: 90,
  windowDays: 180,
});

const thaiTaxRule = rule({
  name: "Thailand — 183-day tax",
  kind: "calendar-year",
  countryCode: "TH",
  limitDays: 183,
});

const caPrRule = rule({
  name: "Canadian PR — presence",
  kind: "presence-minimum",
  countryCode: "CA",
  limitDays: 730,
  windowDays: 1825,
});

describe("day math", () => {
  it("round-trips dates through day numbers", () => {
    expect(dateFromDayNumber(dayNumber("2026-07-20"))).toBe("2026-07-20");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });

  it("counts entry and exit days inclusively", () => {
    const s = stay({
      countryCode: "PT",
      entryDate: "2026-06-01",
      exitDate: "2026-06-03",
    });
    expect(countDays([s], "2026-01-01", "2026-12-31")).toBe(3);
  });

  it("clips open stays at the window end", () => {
    const s = stay({ countryCode: "PT", entryDate: "2026-07-15" });
    expect(countDays([s], "2026-01-01", TODAY)).toBe(6); // Jul 15–20
  });
});

describe("rolling-window rules (Schengen 90/180)", () => {
  it("counts days across all zone members and dedupes overlaps", () => {
    const stays = [
      stay({
        countryCode: "DE",
        entryDate: "2026-02-05",
        exitDate: "2026-03-05",
      }), // 29 days
      stay({ countryCode: "PT", entryDate: "2026-06-09" }), // open, 42 days by Jul 20
      // Overlapping same-zone stay must not double-count:
      stay({
        countryCode: "ES",
        entryDate: "2026-06-10",
        exitDate: "2026-06-12",
      }),
    ];
    const rc = computeRule(schengenRule, stays, TODAY);
    expect(rc.usedDays).toBe(71);
    expect(rc.present).toBe(true);
    expect(rc.severity).toBe("warn"); // 79% used, in-zone
  });

  it("models days aging out of the window when projecting the exit date", () => {
    const stays = [
      stay({
        countryCode: "DE",
        entryDate: "2026-02-05",
        exitDate: "2026-03-05",
      }),
      stay({ countryCode: "PT", entryDate: "2026-06-09" }),
    ];
    // Naive math says exit in 19 days, but the Feb/Mar days age out of the
    // 180-day window while the user keeps staying — the simulation must find
    // the true (later) date: Lisbon-only presence reaches exactly 90 days on
    // Sep 6 (last legal day); Sep 7 would be day 91.
    const exitBy = computeMustExitBy(schengenRule, stays, TODAY);
    expect(exitBy).toBe("2026-09-06");
  });

  it("flags over-limit and computes a re-entry date", () => {
    const stays = [
      stay({
        countryCode: "FR",
        entryDate: "2026-03-01",
        exitDate: "2026-06-01",
      }), // 93 days
    ];
    const rc = computeRule(schengenRule, stays, TODAY);
    expect(rc.usedDays).toBe(93);
    expect(rc.remainingDays).toBe(0);
    expect(rc.statusKey).toBe("over");
    // First window day (Mar 1 = window start only once window slides): days age
    // out one per day; needs 4 days to age out to fit a 1-day visit.
    const reEnter = computeReEnterOn(schengenRule, stays, TODAY);
    expect(reEnter).not.toBeNull();
    expect(dayNumber(reEnter!)).toBeGreaterThan(dayNumber(TODAY));
  });
});

describe("calendar-year rules (183-day tax)", () => {
  it("counts only current-year days", () => {
    const stays = [
      stay({
        countryCode: "TH",
        entryDate: "2025-11-01",
        exitDate: "2026-01-31",
      }), // 31 in 2026
      stay({
        countryCode: "TH",
        entryDate: "2026-03-01",
        exitDate: "2026-03-10",
      }), // 10
    ];
    const rc = computeRule(thaiTaxRule, stays, TODAY);
    expect(rc.usedDays).toBe(41);
    expect(rc.severity).toBe("safe");
  });

  it("goes at-risk near the limit and caps exit date at the remaining allowance", () => {
    const stays = [
      stay({
        countryCode: "TH",
        entryDate: "2026-01-05",
        exitDate: "2026-06-20",
      }), // 167 days
      stay({ countryCode: "TH", entryDate: "2026-07-15" }), // open: 6 more by Jul 20 = 173
    ];
    const rc = computeRule(thaiTaxRule, stays, TODAY);
    expect(rc.usedDays).toBe(173);
    expect(rc.severity).toBe("danger");
    expect(rc.statusKey).toBe("at-risk");
    // 10 days of allowance left, today already counted → Jul 30.
    expect(rc.mustExitBy).toBe("2026-07-30");
    expect(rc.reEnterOn).toBeNull(); // still inside → no re-entry date
  });

  it("does not bind when the year resets before the limit", () => {
    const stays = [stay({ countryCode: "TH", entryDate: "2026-11-01" })];
    const exitBy = computeMustExitBy(thaiTaxRule, stays, "2026-11-15");
    expect(exitBy).toBeNull(); // only 61 days left in the year, limit unreachable
  });
});

describe("presence-minimum rules (Canadian PR)", () => {
  it("reports progress without alarming", () => {
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2025-09-01",
        exitDate: "2025-12-20",
      }), // 111
      stay({
        countryCode: "CA",
        entryDate: "2024-05-01",
        exitDate: "2024-07-15",
      }), // 76
    ];
    const rc = computeRule(caPrRule, stays, TODAY);
    expect(rc.usedDays).toBe(187);
    expect(rc.severity).toBe("safe");
    expect(rc.statusKey).toBe("on-track");
    expect(rc.mustExitBy).toBeNull();
  });

  it("marks the minimum as met", () => {
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2024-01-01",
        exitDate: "2026-01-15",
      }),
    ];
    const rc = computeRule(caPrRule, stays, TODAY);
    expect(rc.statusKey).toBe("met");
  });
});

describe("calendar-year minimums (fiscal residency days)", () => {
  const fiscalRule = rule({
    name: "Canada — fiscal residency days",
    kind: "presence-minimum",
    countryCode: "CA",
    limitDays: 183,
    windowDays: null, // null window = per calendar year
  });

  it("counts only current-year days and stays on-track while feasible", () => {
    // 100 CA days by Jul 20; needs 83 more with 164 days left — feasible.
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2026-01-01",
        exitDate: "2026-04-10",
      }),
    ];
    const rc = computeRule(fiscalRule, stays, TODAY);
    expect(rc.usedDays).toBe(100);
    expect(rc.statusKey).toBe("on-track");
    expect(rc.severity).toBe("safe");
  });

  it("goes at-risk when the target is mathematically out of reach", () => {
    // 30 days by Dec 1; needs 153 more with only 30 days left in the year.
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2026-11-02",
        exitDate: "2026-12-01",
      }),
    ];
    const rc = computeRule(fiscalRule, stays, "2026-12-01");
    expect(rc.usedDays).toBe(30);
    expect(rc.severity).toBe("danger");
    expect(rc.statusKey).toBe("at-risk");
  });

  it("warns when nearly every remaining day is required", () => {
    // 120 days by Oct 22; needs 63 more with 70 days left — under 14-day buffer.
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2026-06-25",
        exitDate: "2026-10-22",
      }),
    ];
    const rc = computeRule(fiscalRule, stays, "2026-10-22");
    expect(rc.usedDays).toBe(120);
    expect(rc.severity).toBe("warn");
    expect(rc.statusKey).toBe("close");
  });

  it("marks the minimum met and resets awareness at the year boundary", () => {
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2026-01-01",
        exitDate: "2026-07-10",
      }),
    ];
    expect(computeRule(fiscalRule, stays, TODAY).statusKey).toBe("met");
    // Same stays evaluated in January 2027: count restarts.
    const nextYear = computeRule(fiscalRule, stays, "2027-01-15");
    expect(nextYear.usedDays).toBe(0);
  });
});

describe("visas", () => {
  // In Lisbon since Jun 9; day-count math alone allows staying to Sep 6.
  const stays = [
    stay({
      countryCode: "DE",
      entryDate: "2026-02-05",
      exitDate: "2026-03-05",
    }),
    stay({ countryCode: "PT", entryDate: "2026-06-09" }),
  ];

  it("caps a rolling-window exit at the visa expiry when it binds first", () => {
    const schengenVisa = visa({
      label: "Schengen C visa",
      zone: "schengen",
      expiresOn: "2026-08-01",
    });
    const rc = applyVisaCap(
      computeRule(schengenRule, stays, TODAY),
      [schengenVisa],
      TODAY,
    );
    expect(rc.mustExitBy).toBe("2026-08-01");
    expect(rc.daysUntilExit).toBe(12);
    expect(rc.cappedByVisaId).toBe("Schengen C visa");
    expect(rc.severity).toBe("danger"); // 12 days out while present
  });

  it("leaves the rule untouched when the day count binds before the visa", () => {
    const schengenVisa = visa({
      label: "Schengen C visa",
      zone: "schengen",
      expiresOn: "2026-12-31",
    });
    const rc = applyVisaCap(
      computeRule(schengenRule, stays, TODAY),
      [schengenVisa],
      TODAY,
    );
    expect(rc.cappedByVisaId).toBeNull();
    expect(rc.mustExitBy).toBe("2026-09-06");
  });

  it("ignores visas that are not yet valid when capping", () => {
    const future = visa({
      label: "Next-year visa",
      zone: "schengen",
      validFrom: "2026-10-01",
      expiresOn: "2026-11-30",
    });
    const rc = applyVisaCap(
      computeRule(schengenRule, stays, TODAY),
      [future],
      TODAY,
    );
    expect(rc.cappedByVisaId).toBeNull();
    expect(computeVisa(future, stays, TODAY).active).toBe(false);
  });

  it("ignores expired visas and rules the user is not present under", () => {
    const expired = visa({
      label: "Old visa",
      zone: "schengen",
      expiresOn: "2026-01-01",
    });
    const rc = applyVisaCap(
      computeRule(schengenRule, stays, TODAY),
      [expired],
      TODAY,
    );
    expect(rc.cappedByVisaId).toBeNull();
    const thai = applyVisaCap(
      computeRule(thaiTaxRule, stays, TODAY),
      [visa({ label: "TH visa", countryCode: "TH", expiresOn: "2026-07-25" })],
      TODAY,
    );
    expect(thai.cappedByVisaId).toBeNull(); // not present in TH
  });

  it("computes expiry severities and raises visa alerts in the snapshot", () => {
    const schengenVisa = visa({
      label: "Schengen C visa",
      zone: "schengen",
      expiresOn: "2026-08-10", // 21 days out, present in zone → warn
    });
    const vc = computeVisa(schengenVisa, stays, TODAY);
    expect(vc.present).toBe(true);
    expect(vc.daysUntilExpiry).toBe(21);
    expect(vc.severity).toBe("warn");

    const snap = computeSnapshot(
      stays,
      [schengenRule],
      {
        fiscalHomeCountry: "CA",
        citizenshipCountry: "TN",
        immigrationStatus: "pr",
        goals: [],
        trackedCountries: ["PT"],
        mailScanEnabled: false,
        scanFrequency: "weekly",
        lastScanAt: null,
        onboardingCompleted: true,
      },
      TODAY,
      [schengenVisa],
    );
    expect(snap.visas[0]?.severity).toBe("warn");
    expect(snap.alerts.some((a) => a.kind === "visa-expiry")).toBe(true);
    // The Schengen rule's exit is capped by the visa (Aug 10 < Sep 6).
    expect(snap.rules[0]?.mustExitBy).toBe("2026-08-10");
    expect(snap.rules[0]?.cappedByVisaId).toBe("Schengen C visa");
  });
});

describe("snapshot", () => {
  const profile: NomadProfile = {
    fiscalHomeCountry: "CA",
    citizenshipCountry: "TN",
    immigrationStatus: "pr",
    goals: ["schengen", "tax"],
    trackedCountries: ["PT", "TH", "AE"],
    mailScanEnabled: true,
    scanFrequency: "weekly",
    lastScanAt: null,
    onboardingCompleted: true,
  };

  it("finds the current location from the open stay", () => {
    const stays = [
      stay({
        countryCode: "AE",
        entryDate: "2026-05-21",
        exitDate: "2026-06-08",
      }),
      stay({ countryCode: "PT", city: "Lisbon", entryDate: "2026-06-09" }),
    ];
    const loc = findCurrentLocation(stays, TODAY);
    expect(loc?.countryCode).toBe("PT");
    expect(loc?.dayNumber).toBe(42);
  });

  it("ignores pending stays in calculations but surfaces them as alerts", () => {
    const stays = [
      stay({ countryCode: "PT", entryDate: "2026-06-09" }),
      stay({
        countryCode: "GE",
        entryDate: "2026-08-08",
        status: "pending",
        source: "inbox",
      }),
    ];
    const snap = computeSnapshot(stays, [schengenRule], profile, TODAY);
    expect(snap.pendingStays).toHaveLength(1);
    expect(snap.alerts.some((a) => a.kind === "pending-stay")).toBe(true);
    const schengen = snap.rules[0];
    expect(schengen.usedDays).toBe(42); // pending Georgia stay not counted
  });

  it("headlines the live counter over already-met minimums", () => {
    // Canada: PR minimum long met (saturated pct) + an active fiscal-residency
    // counter at 55%. The actionable counter must win the headline.
    const fiscalRule = rule({
      id: "ca-fiscal",
      name: "Canada — fiscal residency days",
      kind: "presence-minimum",
      countryCode: "CA",
      limitDays: 183,
      windowDays: null,
    });
    const stays = [
      stay({
        countryCode: "CA",
        entryDate: "2024-01-01",
        exitDate: "2026-04-10",
      }),
    ];
    const snap = computeSnapshot(stays, [caPrRule, fiscalRule], profile, TODAY);
    const ca = snap.countries.find((c) => c.countryCode === "CA");
    expect(ca?.primaryRuleId).toBe("ca-fiscal");
    // Ranked rule ids put the primary first.
    expect(ca?.ruleIds[0]).toBe("ca-fiscal");
  });

  it("computes per-country traffic-light statuses including zone rules", () => {
    const stays = [
      stay({
        countryCode: "DE",
        entryDate: "2026-02-05",
        exitDate: "2026-03-05",
      }),
      stay({ countryCode: "PT", entryDate: "2026-06-09" }),
    ];
    const snap = computeSnapshot(
      stays,
      [schengenRule, thaiTaxRule, caPrRule],
      profile,
      TODAY,
    );
    const pt = snap.countries.find((c) => c.countryCode === "PT");
    expect(pt?.severity).toBe("warn"); // inherits Schengen status
    expect(pt?.here).toBe(true);
    const th = snap.countries.find((c) => c.countryCode === "TH");
    expect(th?.severity).toBe("safe");
    const ca = snap.countries.find((c) => c.countryCode === "CA");
    expect(ca?.severity).toBe("safe"); // minimum rules never alarm the map
  });
});
