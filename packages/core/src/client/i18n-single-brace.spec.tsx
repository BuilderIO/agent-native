// The catalogs are authored against i18next's double-brace delimiter, so a string written
// `Delete the {team} team?` reached the page with its braces. The shared instance now resolves a
// single-brace token when the caller passed that value, and only then. The mutant that makes these
// red is removing `postProcess: [SINGLE_BRACE_POST_PROCESSOR]` (or the `instance.use` line) from
// createI18nInstance: the first two expectations revert to the literal `{team}`.
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AgentNativeI18nProvider,
  createAgentNativeI18nCatalog,
  useT,
} from "./i18n.js";

const messages = {
  singleBraceTemplate: "Delete the {team} team?",
  doubleBraceTemplate: "Good morning, {{name}}.",
  latexExample: String.raw`LaTeX example: \frac{a}{b}`,
  mixedTemplate: "{team} and {{team}}",
  keyTemplate: "Copy the {key} value",
  objectValue: "Model {modelName}",
};

function Probe() {
  const t = useT();
  return React.createElement(
    "dl",
    null,
    React.createElement(
      "dd",
      { id: "single-with-value" },
      t("singleBraceTemplate", { team: "Engineering" }),
    ),
    React.createElement(
      "dd",
      { id: "single-without-value" },
      t("singleBraceTemplate"),
    ),
    React.createElement(
      "dd",
      { id: "double" },
      t("doubleBraceTemplate", { name: "Steve" }),
    ),
    React.createElement("dd", { id: "latex" }, t("latexExample")),
    React.createElement(
      "dd",
      { id: "mixed" },
      t("mixedTemplate", { team: "X" }),
    ),
    React.createElement(
      "dd",
      { id: "key" },
      t("keyTemplate", { key: "Alpha" }),
    ),
    React.createElement(
      "dd",
      { id: "object" },
      t("objectValue", { modelName: { name: "orders" } }),
    ),
  );
}

function renderProbe() {
  const catalog = createAgentNativeI18nCatalog({
    messages,
    supportedLocales: ["en-US"],
  });
  return renderToString(
    React.createElement(
      AgentNativeI18nProvider,
      { catalog, initialLocale: "en-US", persistPreference: false },
      React.createElement(Probe),
    ),
  );
}

describe("single-brace catalog placeholders", () => {
  const html = renderProbe();

  it("resolves a single-brace token when the caller supplies the value", () => {
    expect(html).toContain(">Delete the Engineering team?<");
  });

  it("leaves an unmatched single-brace token visible rather than blanking it", () => {
    expect(html).toContain(">Delete the {team} team?<");
  });

  it("keeps the double-brace convention working and resolves before the fallback runs", () => {
    expect(html).toContain(">Good morning, Steve.<");
    expect(html).toContain(">X and X<");
  });

  it("does not touch literal braces in copy that carries no value for them", () => {
    expect(html).toContain(String.raw`LaTeX example: \frac{a}{b}`);
  });

  it("never substitutes i18next's own option keys into a template", () => {
    expect(html).toContain(">Copy the {key} value<");
  });

  it("only substitutes scalar values", () => {
    expect(html).toContain(">Model {modelName}<");
  });
});
