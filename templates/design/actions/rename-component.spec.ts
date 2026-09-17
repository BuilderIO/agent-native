import { describe, expect, it } from "vitest";

import { componentIndexId } from "../shared/component-model.js";
import {
  renameLinkedComponentHtml,
  ComponentRenameAmbiguousError,
  ComponentRenameConflictError,
} from "./rename-component.js";

describe("renameLinkedComponentHtml", () => {
  it("renames main and reference names without changing other attributes", () => {
    const html = `<main data-agent-native-node-id="main" data-agent-native-component="Old" data-agent-native-component-id="cmp" class="keep"><div data-agent-native-ref="nope"></div></main><section data-agent-native-component-ref="cmp" data-agent-native-node-id="ref">x</section>`;
    const result = renameLinkedComponentHtml(html, "cmp", "New");
    expect(result.changed).toBe(true);
    expect(result.content).toContain(`data-agent-native-component="New"`);
    expect(result.content).toContain(`data-agent-native-component-ref="cmp"`);
    expect(result.content).toContain(`data-agent-native-node-id="main"`);
    expect(result.content).toContain(`class="keep"`);
  });

  it("handles quoted attribute values that contain a closing-angle character", () => {
    const html =
      '<main title="a > b" data-agent-native-component="Old" data-agent-native-component-id="cmp">' +
      '<section data-agent-native-component-ref="cmp" data-agent-native-layer-name="Keep > this">x</section>' +
      "</main>";
    const result = renameLinkedComponentHtml(html, "cmp", "New");

    expect(result.content).toContain('title="a > b"');
    expect(result.content).toContain('data-agent-native-component="New"');
    expect(result.content).toContain(
      'data-agent-native-layer-name="Keep > this"',
    );
  });

  it("exposes the typed legacy ambiguity error", () => {
    expect(new ComponentRenameAmbiguousError()).toBeInstanceOf(
      ComponentRenameAmbiguousError,
    );
  });

  it("exposes a typed name collision error", () => {
    expect(new ComponentRenameConflictError()).toMatchObject({
      name: "ComponentRenameConflictError",
      statusCode: 409,
    });
  });

  it("keeps component index ids deterministic across a rename", () => {
    expect(componentIndexId("design-1", "Old Card")).toBe(
      "ci_design-1_old_card",
    );
    expect(componentIndexId("design-1", "New Card")).toBe(
      "ci_design-1_new_card",
    );
  });
});
