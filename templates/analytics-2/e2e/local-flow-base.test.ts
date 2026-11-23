import { strict as assert } from "node:assert";
import { test } from "node:test";

import { localFlowBase } from "./local-flow-base.js";

const loopback = "127.0.0.1";

await test("local flow origins are limited to assigned loopback ports", () => {
  assert.equal(localFlowBase("http://localhost:8105"), "http://localhost:8105");
  assert.equal(
    localFlowBase(`http://${loopback}:8124`),
    `http://${loopback}:8124`,
  );
  for (const value of [
    "http://localhost:9999",
    "http://example.com:8105",
    "http://localhost:8124/path",
    "https://localhost:8105",
    "http://user@localhost:8105",
  ])
    assert.throws(() => localFlowBase(value));
});

await test("an isolated production fixture can use only its assigned additional port", () => {
  assert.equal(
    localFlowBase(`http://${loopback}:49152`, "49152"),
    `http://${loopback}:49152`,
  );
  for (const value of [
    `http://${loopback}:49153`,
    "http://example.com:49152",
    `https://${loopback}:49152`,
    `http://user@${loopback}:49152`,
    `http://${loopback}:49152/path`,
  ])
    assert.throws(() => localFlowBase(value, "49152"));
  for (const port of ["80", "65536", "49152/path", "", "NaN"])
    assert.throws(() => localFlowBase(`http://${loopback}:49152`, port));
});
