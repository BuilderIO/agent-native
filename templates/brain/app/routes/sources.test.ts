import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readRouteSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("sources route pointer-lock guards", () => {
  it("reuses the shared pointer-unlock helper instead of a local copy", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain(
      'import { afterBodyPointerUnlock } from "@/components/ui/pointer-lock"',
    );
    expect(source).not.toContain("function afterBodyPointerUnlock");
  });

  it("defers opening the tune-source Sheet until the row menu's layer unlocks", () => {
    const source = readRouteSource("./sources.tsx");

    // "Tune source" is a DropdownMenuItem; selecting it opens the setupOpen
    // Sheet (three nested Selects) in the same tick the menu's own
    // dismissable layer is still unregistering. Mounting a new
    // disableOutsidePointerEvents layer before that unregister flushes is
    // the exact race that leaves document.body.style.pointerEvents stuck at
    // "none" forever (see packages/toolkit/src/ui/pointer-lock.ts).
    expect(source).toContain(
      "onTune={() => afterBodyPointerUnlock(() => openEdit(source))}",
    );
  });

  it("defers opening a new source Sheet right after the advanced Sheet closes", () => {
    const source = readRouteSource("./sources.tsx");
    const onAddSourceBlock = source.slice(
      source.indexOf("onAddSource={(provider) => {"),
      source.indexOf("}}", source.indexOf("onAddSource={(provider) => {")) + 2,
    );

    expect(onAddSourceBlock).toContain("setAdvancedOpen(false);");
    expect(onAddSourceBlock).toContain(
      "afterBodyPointerUnlock(() => openCreate(provider));",
    );
  });

  it("defers opening the ingest handoff Dialog until the setup Sheet unlocks", () => {
    const source = readRouteSource("./sources.tsx");
    const submitSourceBlock = source.slice(
      source.indexOf("async function submitSource()"),
      source.indexOf("async function confirmArchiveSource()"),
    );

    // setupOpen has three nested Selects; closing it while immediately
    // mounting the handoff Dialog is the same close-then-open race as the
    // tune-source case above.
    expect(submitSourceBlock).toContain(
      "afterBodyPointerUnlock(() => setIngestHandoff(handoff));",
    );
  });
});

describe("add source drawer config validation", () => {
  it("validates the Allowed channels field through the shared validator", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain('from "../../shared/source-config-validation"');
    expect(source).toContain("validateSlackChannelInput(form.channelRefs)");
    expect(source).toContain("validateGitHubRepoInput(form.githubRepos)");
  });

  it("parses list fields with the same helper the validator uses", () => {
    const source = readRouteSource("./sources.tsx");
    const splitLines = source.slice(
      source.indexOf("function splitLines(value: string)"),
      source.indexOf("function numberValue("),
    );

    // A second local parser is how the field and its validator drift apart:
    // the drawer would accept a value the validator never saw.
    expect(splitLines).toContain("return sourceListValues(value);");
    expect(splitLines).not.toContain(".split(");
  });

  it("blocks Create source while a list field is invalid", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain(
      "const formConfigInvalid =\n    slackChannelIssues.length > 0 || githubRepoIssues.length > 0;",
    );
    expect(source).toContain("formConfigInvalid ||");

    const submitSourceBlock = source.slice(
      source.indexOf("async function submitSource()"),
      source.indexOf("async function confirmArchiveSource()"),
    );
    expect(submitSourceBlock).toContain("if (formConfigInvalid) return;");
  });

  it("shows an inline reason on the offending field", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain('t("sources.invalidAllowedChannels"');
    expect(source).toContain('t("sources.invalidGithubRepositories"');
    expect(source).toContain("aria-invalid={slackChannelIssues.length > 0}");
    expect(source).toContain("aria-invalid={githubRepoIssues.length > 0}");
  });

  it("explains a Slack DM separately from a malformed channel", () => {
    const source = readRouteSource("./sources.tsx");

    // "use a channel ID like C0123456789" is actively wrong advice for someone
    // who typed D0123456789, which already is an ID.
    expect(source).toContain('issue.code === "slack_direct_message"');
    expect(source).toContain('t("sources.invalidSlackDirectMessages"');
  });

  it("warns up front when the provider credential is not configured", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain(
      'formProviderMetadata?.credentialHealth?.status === "missing"',
    );
    expect(source).toContain('t("sources.missingProviderCredential"');
  });
});
