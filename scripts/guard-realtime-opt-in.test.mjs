import assert from "node:assert/strict";
import test from "node:test";

import { findRealtimeOptInViolations } from "./guard-realtime-opt-in.mjs";

const routeOptIn = [
  "useDbSync({",
  "  realtime: isPrivatePath(location.pathname)",
  '    ? { reason: "collaborators can edit this record" }',
  "    : undefined,",
  "});",
].join("\n");

test("accepts a reasoned opt-in behind a pathname gate", () => {
  assert.deepEqual(
    findRealtimeOptInViolations(
      "templates/example/app/root.tsx",
      routeOptIn,
      new Set([2]),
    ),
    [],
  );
});

test("finds inline opt-ins and requires a private route predicate", () => {
  const source =
    'useDbSync({ realtime: isPrivateInboxPath(location.pathname) ? { reason: "new mail arrives" } : undefined });';
  assert.deepEqual(
    findRealtimeOptInViolations(
      "templates/mail/app/root.tsx",
      source,
      new Set([1]),
    ),
    [],
  );
  assert.equal(
    findRealtimeOptInViolations(
      "templates/mail/app/root.tsx",
      source.replace("isPrivateInboxPath", "isInboxPath"),
      new Set([1]),
    )[0]?.missingRouteGate,
    true,
  );
});

test("rejects an opt-in without a reason", () => {
  const source = routeOptIn.replace(
    '{ reason: "collaborators can edit this record" }',
    "{}",
  );
  assert.equal(
    findRealtimeOptInViolations(
      "templates/example/app/root.tsx",
      source,
      new Set([2]),
    )[0]?.missingReason,
    true,
  );
});

test("rejects public and unguarded routes", () => {
  assert.equal(
    findRealtimeOptInViolations(
      "packages/docs/app/root.tsx",
      routeOptIn,
      new Set([2]),
    )[0]?.forbidden,
    true,
  );
  assert.equal(
    findRealtimeOptInViolations(
      "templates/example/app/root.tsx",
      [
        "useDbSync({",
        '  realtime: looksPrivatePath(location.pathname) ? { reason: "collaborators edit" } : undefined,',
        "});",
      ].join("\n"),
      new Set([2]),
    )[0]?.missingRouteGate,
    true,
  );
});

test("allows a reviewed exception with the opt-out pragma", () => {
  const source = [
    "useDbSync({",
    "  // guard:allow-realtime-opt-in — reviewed public collaboration flow",
    '  realtime: { reason: "public document collaboration" },',
    "});",
  ].join("\n");
  assert.deepEqual(
    findRealtimeOptInViolations(
      "templates/public/app/root.tsx",
      source,
      new Set([3]),
    ),
    [],
  );
});
