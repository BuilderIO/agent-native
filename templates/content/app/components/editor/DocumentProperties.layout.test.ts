import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readPropertiesSource() {
  return readFileSync(new URL("./DocumentProperties.tsx", import.meta.url), {
    encoding: "utf8",
  });
}

describe("document property layout", () => {
  it("focuses and selects the property name when the management menu opens", () => {
    const source = readPropertiesSource();

    expect(source).toContain(
      "const propertyNameInputRef = useRef<HTMLInputElement>",
    );
    expect(source).toContain("propertyNameInputRef.current?.focus()");
    expect(source).toContain("propertyNameInputRef.current?.select()");
    expect(source).toContain(
      'aria-label={t("editor.properties.propertyName")}',
    );
  });

  it("focuses and selects scalar property values when a cell editor opens", () => {
    const source = readPropertiesSource();

    expect(source).toContain(
      "const scalarValueInputRef = useRef<HTMLInputElement>",
    );
    expect(source).toContain("scalarValueInputRef.current?.focus()");
    expect(source).toContain("scalarValueInputRef.current?.select()");
    expect(source).toContain('aria-label={t("editor.properties.editValue", {');
  });

  it("lets Escape cancel scalar property value editing", () => {
    const source = readPropertiesSource();

    expect(source).toContain('if (event.key === "Escape")');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("onDone()");
  });

  it("focuses and lets Escape cancel date property editing", () => {
    const source = readPropertiesSource();

    expect(source).toContain(
      "const dateValueInputRef = useRef<HTMLInputElement>",
    );
    expect(source).toContain("dateValueInputRef.current?.focus()");
    expect(source).toContain("dateValueInputRef.current?.select()");
    expect(source).toContain(
      'aria-label={t("editor.properties.editStartDate", {',
    );
  });

  it("focuses and lets Escape cancel option property editing", () => {
    const source = readPropertiesSource();

    expect(source).toContain(
      "const optionSearchInputRef = useRef<HTMLInputElement>",
    );
    expect(source).toContain("optionSearchInputRef.current?.focus()");
    expect(source).toContain("optionSearchInputRef.current?.select()");
    expect(source).toContain(
      'aria-label={t("editor.properties.searchPropertyOptions", {',
    );
  });

  it("returns focus to search after multi-select option changes", () => {
    const source = readPropertiesSource();

    expect(source).toContain("function queueOptionSearchFocus()");
    expect(source).toContain("const frame = queueOptionSearchFocus()");
    expect(source).toContain("await setSelected(next)");
    expect(source).toContain("queueOptionSearchFocus()");
  });

  it("focuses Add Property and lets type search submit the first match", () => {
    const source = readPropertiesSource();

    expect(source).toContain(
      "const addPropertySearchInputRef = useRef<HTMLInputElement>",
    );
    expect(source).toContain("addPropertySearchInputRef.current?.focus()");
    expect(source).toContain("addPropertySearchInputRef.current?.select()");
    expect(source).toContain(
      'aria-label={t("editor.properties.searchPropertyTypes")}',
    );
    expect(source).toContain("const firstFilteredPropertyType");
    expect(source).toContain("void add(firstFilteredPropertyType)");
  });

  it("makes editable property value triggers fill the database cell", () => {
    const source = readPropertiesSource();

    expect(source).toContain(
      "flex min-h-6 w-full min-w-0 items-center rounded px-1 text-left",
    );
  });

  it("can render property popovers inside non-modal parent surfaces", () => {
    const source = readPropertiesSource();

    expect(source).toContain("popoversPortalled = true");
    expect(source).toContain("portalled={popoversPortalled}");
    expect(source).toContain("portalled={portalled}");
  });
});
