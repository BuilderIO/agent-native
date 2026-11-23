import { readFileSync, writeFileSync } from "node:fs";

import { referenceCoverageSummary } from "./reference-coverage-summary";
import frozenCoverage from "./reference-coverage.json";

const before = referenceCoverageSummary();
const coverage = frozenCoverage.map((row) => ({ ...row }));
const initial = JSON.stringify(coverage);
const imageSpec = "app/skins/reference/sidebar-shell/AccountImage.spec.tsx";
readFileSync(imageSpec);
for (const id of ["sidebar.footer", "sidebar.account.open"]) {
  const row = coverage.find((entry) => entry.id === id);
  if (!row || !row.counted) throw new Error(`Missing counted image row: ${id}`);
  for (const suffix of ["", "-surface"]) {
    const witness = {
      fixture: "account-identity-image",
      baseline: `app/testing/sidebar-shell/reference-fixtures/account-identity-image${suffix}.json`,
      spec: imageSpec,
    };
    const frozen = JSON.parse(readFileSync(witness.baseline, "utf8")) as {
      name: string;
      rows: string[];
    };
    if (frozen.name !== witness.fixture || !frozen.rows.includes(id))
      throw new Error(`Image evidence does not own ${id}: ${witness.baseline}`);
    if (
      !row.witnesses.some(
        (existing) =>
          existing.baseline === witness.baseline &&
          existing.spec === witness.spec,
      )
    )
      row.witnesses = [...row.witnesses, witness];
  }
  row.status = "rendered-matched";
  row.reason =
    "Initial, email, empty and image identities match the frozen captures; typed icon.image preserves the source and decorative empty alt.";
}
const navigation = coverage.find((row) => row.id === "shell.nav");
const error = coverage.find((row) => row.id === "shell.error");
if (!navigation || !error) throw new Error("Missing aggregate shell rows");
navigation.reason =
  "The complete account-image navigation state now matches. Setup states still omit the named custom setup-card body; complete navigation in those states remains different. No custom-body or mounted credit.";
navigation.proofBoundary =
  "AccountImage.spec.tsx compares both frozen account-identity-image captures: exact account opener, footer, full sidebar and root/storage envelope. Sidebar.spec.tsx isolates all seven setup-state sidebar differences to the omitted custom card. These captures retain their existing row ids; no new aggregate identity is inferred. Setup parent remains an empty custom owner.";
navigation.accountingNote =
  "This canonical ledger consolidates rounds 1–6 and the image follow-up. Superseded proposals are retained as historical evidence, not active counts. Hosts are untouched; mounted and strict are zero. Inline section markup and the typed account-image state are resolved.";
error.reason =
  "Error status/title/details/Go home/stack match exactly. The declared kit-owned error-report-actions slot remains empty: its report controls, generated report context and session behavior require host slot binding outside this renderer-only scope. Full-row markup and report behavior are not credited.";
if (JSON.stringify(coverage) !== initial)
  writeFileSync(
    new URL("./reference-coverage.json", import.meta.url),
    `${JSON.stringify(coverage, null, 2)}\n`,
  );
console.log(
  JSON.stringify({ before, after: referenceCoverageSummary() }, null, 2),
);
