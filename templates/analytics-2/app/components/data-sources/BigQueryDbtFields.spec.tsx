/**
 * Focused behavior checks for the BigQuery dbt metadata fields.
 *
 * The component is metadata-only: it renders the source's INTEGRATIONS dbt
 * toggle, version choice and the fields the served form shows for each version
 * (the JDBC driver / certificate flags are not part of this surface). Every
 * control reports through onConfigChange or onTokenChange and nothing here
 * persists, logs or displays the service token.
 */
// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataSourceMessages } from "@/i18n/messages/data-sources";

import { BigQueryDbtFields, type BigQueryDbtConfig } from "./BigQueryDbtFields";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const KEYS = {
  integrations: "sources.addConnection.bigquery.integrations",
  dbt: "sources.addConnection.bigquery.dbt",
  version: "sources.addConnection.bigquery.version",
  versionCurrent: "sources.addConnection.bigquery.versionCurrent",
  versionLegacy: "sources.addConnection.bigquery.versionLegacy",
  accessUrl: "sources.addConnection.bigquery.accessUrl",
  accountId: "sources.addConnection.bigquery.accountId",
  projectId: "sources.addConnection.bigquery.projectId",
  environmentId: "sources.addConnection.bigquery.environmentId",
  environmentIdOptional: "sources.addConnection.bigquery.environmentIdOptional",
  serviceToken: "sources.addConnection.bigquery.serviceToken",
} as const;

const IDS = {
  enabled: "bigquery-dbt-enabled",
  version: "bigquery-dbt-version",
  accessUrl: "bigquery-dbt-access-url",
  accountId: "bigquery-dbt-account-id",
  projectId: "bigquery-dbt-project-id",
  environmentId: "bigquery-dbt-environment-id",
  token: "bigquery-dbt-token",
} as const;

function Harness({
  disabled = false,
  initialConfig = {},
  initialToken = "",
  onConfigChange,
  onTokenChange,
  tokenConfigured = false,
}: {
  disabled?: boolean;
  initialConfig?: BigQueryDbtConfig;
  initialToken?: string;
  onConfigChange: (next: BigQueryDbtConfig) => void;
  onTokenChange: (next: string) => void;
  tokenConfigured?: boolean;
}) {
  const [config, setConfig] = useState<BigQueryDbtConfig>(initialConfig);
  const [token, setToken] = useState(initialToken);
  return (
    <BigQueryDbtFields
      config={config}
      disabled={disabled}
      onConfigChange={(next) => {
        onConfigChange(next);
        setConfig(next);
      }}
      onTokenChange={(next) => {
        onTokenChange(next);
        setToken(next);
      }}
      token={token}
      tokenConfigured={tokenConfigured}
    />
  );
}

let container: HTMLDivElement;
let root: Root | undefined;

function render(props: {
  disabled?: boolean;
  initialConfig?: BigQueryDbtConfig;
  initialToken?: string;
  tokenConfigured?: boolean;
}) {
  const onConfigChange = vi.fn<(next: BigQueryDbtConfig) => void>();
  const onTokenChange = vi.fn<(next: string) => void>();
  root = createRoot(container);
  act(() => {
    root?.render(
      <Harness
        disabled={props.disabled ?? false}
        initialConfig={props.initialConfig ?? {}}
        initialToken={props.initialToken ?? ""}
        onConfigChange={onConfigChange}
        onTokenChange={onTokenChange}
        tokenConfigured={props.tokenConfigured ?? false}
      />,
    );
  });
  return { onConfigChange, onTokenChange };
}

function byId<T extends Element = HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[id="${id}"]`);
}

function toggle(): HTMLElement | null {
  return byId<HTMLElement>(IDS.enabled);
}

function input(id: string): HTMLInputElement | null {
  return byId<HTMLInputElement>(id);
}

function textNodes(): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    found.push(node.textContent ?? "");
  }
  return found;
}

function labels(): string[] {
  return [...container.querySelectorAll("label")].map((label) =>
    (label.textContent ?? "").trim(),
  );
}

async function setInputValue(target: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(target: Element | null) {
  expect(target).toBeTruthy();
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function chooseVersion(optionKey: string) {
  const trigger = byId<HTMLButtonElement>(IDS.version);
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger?.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const option = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === optionKey);
  expect(option).toBeDefined();
  await act(async () => {
    option?.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    option?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("BigQuery dbt metadata fields", () => {
  it("starts with the INTEGRATIONS heading and the dbt toggle off", () => {
    render({ initialConfig: {} });
    expect(container.textContent).toContain(KEYS.integrations);
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
    expect(byId(IDS.version)).toBeNull();
    expect(input(IDS.accessUrl)).toBeNull();
    expect(input(IDS.accountId)).toBeNull();
    expect(input(IDS.environmentId)).toBeNull();
    expect(input(IDS.token)).toBeNull();
  });

  it("reports the toggle through onConfigChange and reveals the version choice", async () => {
    const { onConfigChange } = render({
      initialConfig: { hasDbtMetadata: false },
    });
    await click(toggle());
    expect(onConfigChange).toHaveBeenCalledExactlyOnceWith({
      hasDbtMetadata: true,
    });
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    expect(byId<HTMLButtonElement>(IDS.version)).toBeTruthy();
    expect(input(IDS.accessUrl)).toBeNull();
    expect(input(IDS.accountId)).toBeNull();
  });

  it("renders the current-version fields and sends an exact config payload", async () => {
    const { onConfigChange, onTokenChange } = render({
      initialConfig: {
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtCloudHostname: "cloud.getdbt.com",
      },
    });

    expect(labels()).toEqual(
      expect.arrayContaining([
        `${KEYS.version} *`,
        `${KEYS.accessUrl} *`,
        `${KEYS.environmentId} *`,
        `${KEYS.serviceToken} *`,
      ]),
    );
    expect(input(IDS.accessUrl)?.value).toBe("cloud.getdbt.com");
    expect(input(IDS.accountId)).toBeNull();
    expect(input(IDS.projectId)).toBeNull();

    await setInputValue(input(IDS.accessUrl)!, "acme.getdbt.com");
    expect(onConfigChange).toHaveBeenLastCalledWith({
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtCloudHostname: "acme.getdbt.com",
    });
    expect(input(IDS.accessUrl)?.value).toBe("acme.getdbt.com");

    const beforeToken = onConfigChange.mock.calls.length;
    await setInputValue(input(IDS.token)!, "dbt_current_token");
    expect(onTokenChange).toHaveBeenLastCalledWith("dbt_current_token");
    expect(onConfigChange.mock.calls.length).toBe(beforeToken);
    expect(container.textContent).not.toContain("dbt_current_token");

    await setInputValue(input(IDS.environmentId)!, "991");
    expect(onConfigChange).toHaveBeenLastCalledWith({
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtCloudHostname: "acme.getdbt.com",
      dbtEnvironmentId: "991",
    });
  });

  it("renders the legacy-version fields and sends an exact config payload", async () => {
    const { onConfigChange } = render({
      initialConfig: {
        hasDbtMetadata: true,
        dbtVersion: "legacy",
        dbtAccountId: "12345",
        dbtProjectId: "analytics",
      },
    });

    expect(byId(IDS.version)).toBeTruthy();
    expect(input(IDS.accessUrl)).toBeNull();
    expect(input(IDS.accountId)?.value).toBe("12345");
    expect(input(IDS.projectId)?.value).toBe("analytics");
    expect(input(IDS.token)).toBeTruthy();
    expect(input(IDS.environmentId)).toBeTruthy();
    expect(labels()).toEqual(
      expect.arrayContaining([
        `${KEYS.accountId} *`,
        `${KEYS.projectId} *`,
        `${KEYS.serviceToken} *`,
        KEYS.environmentIdOptional,
      ]),
    );
    // Legacy's Environment ID is optional, unlike the current version's.
    expect(input(IDS.environmentId)?.required).toBe(false);

    await setInputValue(input(IDS.projectId)!, "analytics_prod");
    expect(onConfigChange).toHaveBeenLastCalledWith({
      hasDbtMetadata: true,
      dbtVersion: "legacy",
      dbtAccountId: "12345",
      dbtProjectId: "analytics_prod",
    });

    await setInputValue(input(IDS.accountId)!, "67890");
    expect(onConfigChange).toHaveBeenLastCalledWith({
      hasDbtMetadata: true,
      dbtVersion: "legacy",
      dbtAccountId: "67890",
      dbtProjectId: "analytics_prod",
    });
  });

  it("keeps entered values and other config when the version changes", async () => {
    const { onConfigChange, onTokenChange } = render({
      initialConfig: {
        hasDbtMetadata: true,
        dbtVersion: "legacy",
        dbtAccountId: "12345",
        dbtProjectId: "analytics",
        dbtEnvironmentId: "42",
      },
      initialToken: "dbt_legacy_token",
    });
    expect(input(IDS.token)?.value).toBe("dbt_legacy_token");

    await chooseVersion(KEYS.versionCurrent);
    expect(onConfigChange).toHaveBeenLastCalledWith({
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtAccountId: "12345",
      dbtProjectId: "analytics",
      dbtEnvironmentId: "42",
    });
    // No silent default access URL and no lost token state.
    expect(input(IDS.accessUrl)?.value).toBe("");
    expect(input(IDS.environmentId)?.value).toBe("42");
    expect(input(IDS.token)?.value).toBe("dbt_legacy_token");
    expect(onTokenChange).not.toHaveBeenCalled();

    await chooseVersion(KEYS.versionLegacy);
    expect(onConfigChange).toHaveBeenLastCalledWith({
      hasDbtMetadata: true,
      dbtVersion: "legacy",
      dbtAccountId: "12345",
      dbtProjectId: "analytics",
      dbtEnvironmentId: "42",
    });
    expect(input(IDS.accountId)?.value).toBe("12345");
    expect(input(IDS.projectId)?.value).toBe("analytics");
    expect(input(IDS.token)?.value).toBe("dbt_legacy_token");
  });

  it("masks the service token and only requires it while none is configured", async () => {
    const missing = render({
      initialConfig: { hasDbtMetadata: true, dbtVersion: "current" },
      tokenConfigured: false,
    });
    const missingToken = input(IDS.token)!;
    expect(missingToken.type).toBe("password");
    expect(missingToken.getAttribute("autocomplete")).toBe("off");
    expect(missingToken.required).toBe(true);
    expect(missingToken.value).toBe("");

    await setInputValue(missingToken, "first_secret");
    expect(missing.onTokenChange).toHaveBeenLastCalledWith("first_secret");
    expect(container.textContent).not.toContain("first_secret");
    expect(textNodes().some((text) => text.includes("first_secret"))).toBe(
      false,
    );

    act(() => root?.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.append(container);

    const configured = render({
      initialConfig: { hasDbtMetadata: true, dbtVersion: "current" },
      tokenConfigured: true,
    });
    const configuredToken = input(IDS.token)!;
    expect(configuredToken.type).toBe("password");
    expect(configuredToken.required).toBe(false);
    expect(configuredToken.value).toBe("");
    await setInputValue(configuredToken, "replacement_secret");
    expect(configured.onTokenChange).toHaveBeenLastCalledWith(
      "replacement_secret",
    );
    expect(container.textContent).not.toContain("replacement_secret");
    expect(
      textNodes().some((text) => text.includes("replacement_secret")),
    ).toBe(false);
  });

  it("prevents every update while disabled", async () => {
    const { onConfigChange, onTokenChange } = render({
      disabled: true,
      initialConfig: {
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtCloudHostname: "cloud.getdbt.com",
      },
    });

    expect(toggle()?.hasAttribute("disabled")).toBe(true);
    expect(byId<HTMLButtonElement>(IDS.version)?.disabled).toBe(true);
    for (const id of [IDS.accessUrl, IDS.environmentId, IDS.token]) {
      expect(input(id)?.disabled).toBe(true);
    }

    await click(toggle());
    await setInputValue(input(IDS.accessUrl)!, "acme.getdbt.com");
    await setInputValue(input(IDS.environmentId)!, "991");
    await setInputValue(input(IDS.token)!, "disabled_secret");

    expect(onConfigChange).not.toHaveBeenCalled();
    expect(onTokenChange).not.toHaveBeenCalled();
    expect(input(IDS.accessUrl)?.value).toBe("cloud.getdbt.com");
  });

  it("offers no separate Semantic Layer switch: 1.6+ connections are queried from the Metric cell", () => {
    render({
      initialConfig: {
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtCloudHostname: "cloud.getdbt.com",
      },
    });
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("semantic");
    expect(text).not.toContain("jdbc");
    expect(text).not.toContain("certificate");
  });

  it("keeps the served functional copy for the version options", () => {
    const bigquery = dataSourceMessages.sources.addConnection.bigquery;
    expect(bigquery.integrations).toBe("INTEGRATIONS");
    expect(bigquery.dbt).toBe("dbt");
    expect(bigquery.version).toBe("Version");
    expect(bigquery.versionCurrent).toBe("1.6+");
    expect(bigquery.versionLegacy).toBe("1.5 and below");
    expect(bigquery.accessUrl).toBe("Access URL");
    expect(bigquery.accountId).toBe("Account ID");
    expect(bigquery.projectId).toBe("Project ID");
    expect(bigquery.environmentId).toBe("Environment ID");
    expect(bigquery.environmentIdOptional).toBe("Environment ID (optional)");
    expect(bigquery.serviceToken).toBe("Service token");
  });
});
