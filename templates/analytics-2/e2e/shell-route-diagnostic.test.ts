import assert from "node:assert/strict";
import { test } from "node:test";

import { shellRouteDiagnostic } from "./shell-route-diagnostic.js";

const base = "https://labs.example.test/analytics-2";
const projectId = "prj_0123456789abcdef0123456789abcdef";

await test("names the project route without exposing the project id", () => {
  const line = shellRouteDiagnostic(
    `${base}/project/${projectId}/latest`,
    base,
    projectId,
  );
  assert.deepEqual(line, { route: "project", matchesExpected: true });
  assert.equal(JSON.stringify(line).includes(projectId), false);
});

await test("reports a redirect to Home as a different route than the one opened", () => {
  assert.deepEqual(shellRouteDiagnostic(`${base}/home`, base, projectId), {
    route: "home",
    matchesExpected: false,
  });
});

await test("a different project is not the expected route", () => {
  assert.deepEqual(
    shellRouteDiagnostic(`${base}/project/prj_other/latest`, base, projectId),
    { route: "project", matchesExpected: false },
  );
});

await test("treats foreign origins and unparsable urls as unknown", () => {
  for (const url of ["https://other.example.test/home", "not a url", ""]) {
    assert.deepEqual(shellRouteDiagnostic(url, base, projectId), {
      route: "unknown",
      matchesExpected: false,
    });
  }
});

await test("keeps query and hash out of the diagnostic", () => {
  const line = shellRouteDiagnostic(
    `${base}/settings/general?token=private-fixture#private-fixture`,
    base,
    projectId,
  );
  assert.deepEqual(line, { route: "other", matchesExpected: false });
});
