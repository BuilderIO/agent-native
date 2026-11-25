// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { compareRowSnapshots } from "./compare.js";
import { captureRows, rowAttributes } from "./dom.js";
import { rowIdSegment } from "./ids.js";
import type { ModelRow, ScreenModel } from "./types.js";
import {
  assertValidModel,
  flattenModel,
  InvalidModelError,
  validateModel,
} from "./validate.js";

const navigation: ScreenModel = {
  id: "sidebar",
  rows: [
    {
      id: "sidebar.main",
      part: "sidebar.section",
      kind: "section",
      label: "Main",
      rows: [
        {
          id: "sidebar.nav.inbox",
          part: "sidebar.item",
          kind: "destination",
          label: "Inbox",
          icon: { kind: "symbol", key: "inbox" },
          state: { selected: true, badge: { kind: "count", value: 19 } },
          effect: { kind: "navigate", to: "/inbox" },
        },
        {
          id: "sidebar.create.issue",
          part: "sidebar.item",
          kind: "action",
          label: "New issue",
          effect: { kind: "action", effectId: "create-issue" },
        },
      ],
    },
  ],
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("validateModel", () => {
  it("accepts a well-formed model", () => {
    expect(validateModel(navigation)).toEqual([]);
    expect(assertValidModel(navigation)).toBe(navigation);
  });

  it("reports every structural problem, not just the first", () => {
    const broken: ScreenModel = {
      id: "broken",
      rows: [
        { id: "Inbox", part: "sidebar.item", label: "Inbox" },
        { id: "broken.a", part: "sidebar.widget", label: " " },
        { id: "broken.a", part: "sidebar.item", label: "Twice" },
        {
          id: "broken.empty",
          part: "sidebar.section",
          kind: "section",
          label: "Empty",
        },
        {
          id: "broken.opens",
          part: "sidebar.item",
          label: "Open",
          effect: { kind: "open", target: "broken.nowhere" },
        },
        {
          id: "broken.regions",
          part: "settings.row",
          label: "Regions",
          regions: { Status: "status", detail: " " },
        },
        {
          id: "broken.hosts",
          part: "settings.group",
          label: "Hosts",
          hosts: ["broken.hosted"],
        },
        {
          id: "broken.hosts-in-region",
          part: "settings.section",
          label: "Hosts in a region",
          regions: { body: "body" },
          hosts: ["broken.hosted-in-region"],
        },
      ],
    };
    expect(validateModel(broken).map((issue) => issue.code)).toEqual([
      "invalid-id",
      "unknown-part",
      "empty-label",
      "duplicate-id",
      "section-without-rows",
      "invalid-region",
      "invalid-region",
      "hosts-without-slot",
      "open-target-missing",
    ]);
    expect(() => assertValidModel(broken)).toThrow(InvalidModelError);
  });

  it("flattens in document order with depth and parent", () => {
    expect(
      flattenModel(navigation).map(({ row, depth, parentId }) => [
        row.id,
        depth,
        parentId,
      ]),
    ).toEqual([
      ["sidebar.main", 0, undefined],
      ["sidebar.nav.inbox", 1, "sidebar.main"],
      ["sidebar.create.issue", 1, "sidebar.main"],
    ]);
  });
});

describe("rowIdSegment", () => {
  it("keeps a valid segment and makes any other value one", () => {
    expect(rowIdSegment("rule-42")).toBe("rule-42");
    const email = rowIdSegment("Ada.Lovelace@example.com");
    expect(email).toMatch(/^ada-lovelace-example-com-[a-z0-9]+$/);
    expect(
      validateModel({
        id: "usage",
        rows: [
          { id: `usage.member.${email}`, part: "settings.row", label: "Ada" },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps values that slug alike apart, and is stable", () => {
    expect(rowIdSegment("a.b@x.com")).not.toBe(rowIdSegment("a-b@x.com"));
    expect(rowIdSegment("a.b@x.com")).toBe(rowIdSegment("a.b@x.com"));
    expect(rowIdSegment("@@")).toMatch(/^x-[a-z0-9]+$/);
  });
});

describe("rowAttributes", () => {
  it("encodes hosted rows, a completed setup and an attention badge", () => {
    expect(
      rowAttributes({
        id: "settings.panel.llm",
        part: "settings.section",
        label: "LLM",
        slot: "body",
        hosts: ["settings.panel.llm.provider", "settings.panel.llm.key"],
        state: {
          complete: true,
          badge: { kind: "label", value: "Required", tone: "attention" },
        },
      }),
    ).toMatchObject({
      "data-rid-hosts": "settings.panel.llm.provider settings.panel.llm.key",
      "data-rid-complete": "true",
      "data-rid-badge": "label-attention:Required",
    });
  });

  it("encodes regions in region order", () => {
    expect(
      rowAttributes({
        id: "settings.model.default",
        part: "settings.row",
        label: "Default model",
        regions: { status: "model-source", detail: "model-picker" },
      })["data-rid-regions"],
    ).toBe("detail:model-picker status:model-source");
  });

  it("encodes id, part, kind, effect and badge", () => {
    const inbox = navigation.rows[0]?.rows?.[0];
    if (!inbox) throw new Error("fixture row missing");
    expect(rowAttributes(inbox)).toEqual({
      "data-rid": "sidebar.nav.inbox",
      "data-part": "sidebar.item",
      "data-rid-kind": "destination",
      "data-rid-effect": "navigate:/inbox",
      "data-rid-badge": "count:19",
    });
  });
});

function attrs(row: ModelRow): string {
  return Object.entries(rowAttributes(row))
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
}

const main = navigation.rows.at(0);
const inbox = main?.rows?.at(0);
const create = main?.rows?.at(1);
if (!main || !inbox || !create) throw new Error("fixture rows missing");

const ours = `
  <nav ${attrs(main)} aria-label="Main">
    <a ${attrs(inbox)} href="/inbox" aria-current="page">
      <svg aria-hidden="true"></svg><span>Inbox</span><span aria-hidden="true">19</span>
    </a>
    <button ${attrs(create)} type="button" aria-label="New issue"><svg></svg></button>
  </nav>`;

const target = `
  <div role="listbox" ${attrs(main)} aria-label="Main">
    <div role="option" ${attrs(inbox)} aria-selected="true">Inbox <b aria-hidden="true">19</b></div>
    <div role="option" ${attrs(create)} aria-selected="false" aria-label="New issue">+</div>
  </div>`;

function render(html: string) {
  document.body.innerHTML = html;
  return captureRows(document);
}

describe("captureRows", () => {
  it("reads names, state and effects from either part set's markup", () => {
    const rows = render(ours);
    expect(rows.map((row) => [row.id, row.name, row.selected])).toEqual([
      ["sidebar.main", "Main", false],
      ["sidebar.nav.inbox", "Inbox", true],
      ["sidebar.create.issue", "New issue", false],
    ]);
    expect(rows[1]).toMatchObject({
      parentId: "sidebar.main",
      position: 0,
      effect: "navigate:/inbox",
      badge: "count:19",
    });
    expect(rows[2]?.position).toBe(1);
  });

  it("leaves nested rows out of a parent's name", () => {
    document.body.innerHTML = `<section ${attrs(main)}><h3>Main</h3>${ours.replace(/<nav[^>]*>|<\/nav>/g, "")}</section>`;
    expect(captureRows(document)[0]?.name).toBe("Main");
  });

  it("reads native control state for toggles and fields", () => {
    document.body.innerHTML = `
      <div data-rid="settings.email.digest" data-part="settings.row" data-rid-kind="toggle">
        <span data-rid-label>Daily digest</span>
        <input type="checkbox" checked disabled>
      </div>
      <div data-rid="settings.email.address" data-part="settings.row" data-rid-kind="field">
        <label for="address">Address</label>
        <input id="address" aria-label="Address" value="team@example.test">
      </div>`;
    const [digest, address] = captureRows(document);
    expect(digest).toMatchObject({
      name: "Daily digest",
      checked: "true",
      disabled: true,
    });
    expect(address).toMatchObject({
      name: "Address",
      value: "team@example.test",
    });
  });
});

describe("compareRowSnapshots", () => {
  it("finds two differently drawn part sets equivalent", () => {
    const report = compareRowSnapshots(render(ours), render(target));
    expect(report.compared).toBe(3);
    expect(report.differences).toEqual([]);
  });

  it("reports a changed name, a lost state and a missing row", () => {
    const changed = target
      .replace('aria-selected="true">Inbox', 'aria-selected="false">Mail')
      .replace(/<div role="option"[^>]*create\.issue[\s\S]*?<\/div>/, "");
    const report = compareRowSnapshots(render(ours), render(changed));
    expect(
      report.differences.map((difference) => [
        difference.rowId,
        difference.field,
      ]),
    ).toEqual([
      ["sidebar.nav.inbox", "name"],
      ["sidebar.nav.inbox", "selected"],
      ["sidebar.create.issue", "extra"],
    ]);
  });

  it("moves a reasoned difference to accepted and refuses an unreasoned one", () => {
    const renamed = target.replace(">Inbox <", ">All mail <");
    const report = compareRowSnapshots(render(ours), render(renamed), [
      {
        rowId: "sidebar.nav.inbox",
        field: "name",
        reason: "This target names the inbox All mail.",
      },
    ]);
    expect(report.differences).toEqual([]);
    expect(report.accepted).toHaveLength(1);
    expect(() =>
      compareRowSnapshots(render(ours), render(renamed), [
        { rowId: "*", field: "name", reason: "ok" },
      ]),
    ).toThrow(/needs a reason/);
  });

  it("refuses a part set that renders a row twice", () => {
    const doubled = `${ours}${ours}`;
    expect(() => compareRowSnapshots(render(doubled), render(target))).toThrow(
      /rendered twice/,
    );
  });
});
