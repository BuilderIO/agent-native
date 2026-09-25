// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileStorageStatus } from "../../file-upload/storage-settings.js";
import englishMessages from "../../localization/core-messages/en-US.js";

const queryState = vi.hoisted(() => ({
  data: undefined as FileStorageStatus | undefined,
  isError: false,
}));
const mutateMock = vi.hoisted(() => vi.fn());

vi.mock("../use-action.js", () => ({
  useActionQuery: () => ({
    data: queryState.data,
    isError: queryState.isError,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({ mutate: mutateMock }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
}));

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, string>): string => {
      const flat = englishMessages as Record<string, string>;
      const template = flat[key.replace(/^agentChat\./, "")] ?? key;
      return template.replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => options?.[name] ?? "",
      );
    },
}));

import { StorageSettingsForm } from "./StorageSettingsForm.js";

const savedStatus: FileStorageStatus = {
  canManage: true,
  configured: true,
  provider: "cloudflare-r2",
  endpoint: "https://abc.r2.cloudflarestorage.com",
  bucket: "uploads-example",
  region: null,
  publicBaseUrl: "https://cdn.example.com",
  saved: {
    endpoint: true,
    bucket: true,
    accessKeyId: true,
    secretAccessKey: true,
    region: false,
    publicBaseUrl: true,
  },
  publicUrlRequired: true,
  activeProvider: { id: "s3", name: "S3-compatible object storage" },
  builderUploadConfigured: false,
};

const emptyStatus: FileStorageStatus = {
  ...savedStatus,
  configured: false,
  provider: null,
  endpoint: null,
  bucket: null,
  publicBaseUrl: null,
  saved: {
    endpoint: false,
    bucket: false,
    accessKeyId: false,
    secretAccessKey: false,
    region: false,
    publicBaseUrl: false,
  },
  activeProvider: null,
};

function inputByLabel(label: string): HTMLInputElement {
  const labelEl = [...document.querySelectorAll("label")].find(
    (el) => el.textContent === label,
  );
  if (!labelEl) throw new Error(`No label ${label}`);
  return document.getElementById(labelEl.htmlFor) as HTMLInputElement;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text,
  );
  if (!button) throw new Error(`No button ${text}`);
  return button as HTMLButtonElement;
}

describe("StorageSettingsForm", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryState.data = undefined;
    queryState.isError = false;
    mutateMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const render = (element = <StorageSettingsForm />) =>
    act(() => root.render(element));

  it("shows a layout skeleton while the status loads", () => {
    render();
    expect(container.querySelector("form")).toBeNull();
    expect(
      container.querySelectorAll("[aria-hidden] div").length,
    ).toBeGreaterThan(0);
  });

  it("tells members only owners and admins can change storage", () => {
    queryState.data = { ...emptyStatus, canManage: false };
    render();
    expect(container.textContent).toContain(
      "Only organization owners and admins can change file storage.",
    );
    expect(container.querySelector("input")).toBeNull();
  });

  it("prefills saved values and marks saved keys", () => {
    queryState.data = savedStatus;
    render();
    expect(inputByLabel("Endpoint URL").value).toBe(
      "https://abc.r2.cloudflarestorage.com",
    );
    expect(inputByLabel("Bucket").value).toBe("uploads-example");
    expect(inputByLabel("Access key ID").placeholder).toBe("Saved");
    expect(inputByLabel("Secret access key").placeholder).toBe("Saved");
    expect(inputByLabel("Access key ID").value).toBe("");
    expect(container.textContent).toContain(
      "Find it in your R2 bucket's settings.",
    );
  });

  it("requires the keys and public URL on first setup", () => {
    queryState.data = emptyStatus;
    render();
    typeInto(inputByLabel("Endpoint URL"), "https://s3.example.com");
    typeInto(inputByLabel("Bucket"), "uploads-example");
    act(() => buttonByText("Save").click());
    expect(container.textContent).toContain(
      "Fill in the endpoint, bucket, keys, and public URL first.",
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("makes the public URL optional when the provider serves without one", () => {
    queryState.data = { ...emptyStatus, publicUrlRequired: false };
    render();
    expect(inputByLabel("Public URL").placeholder).toBe("Optional");
    typeInto(inputByLabel("Endpoint URL"), "https://s3.example.com");
    typeInto(inputByLabel("Bucket"), "uploads-example");
    typeInto(inputByLabel("Access key ID"), "access-example");
    typeInto(inputByLabel("Secret access key"), "secret-example");
    act(() => buttonByText("Save").click());
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "save",
        accessKeyId: "access-example",
        publicBaseUrl: "",
      }),
      expect.anything(),
    );
  });

  it("keeps saved keys by leaving them out of the save", () => {
    queryState.data = savedStatus;
    render();
    typeInto(inputByLabel("Bucket"), "renamed-bucket");
    act(() => buttonByText("Save").click());
    const [input] = mutateMock.mock.calls[0]!;
    expect(input).toMatchObject({
      operation: "save",
      bucket: "renamed-bucket",
    });
    expect(input).not.toHaveProperty("accessKeyId");
    expect(input).not.toHaveProperty("secretAccessKey");
  });

  it("confirms before clearing and names where uploads go", () => {
    const onCleared = vi.fn();
    queryState.data = savedStatus;
    mutateMock.mockImplementation(
      (
        _input: unknown,
        options: {
          onSuccess: (result: unknown) => void;
          onSettled: () => void;
        },
      ) => {
        options.onSuccess({ removedKeys: ["S3_BUCKET"], status: emptyStatus });
        options.onSettled();
      },
    );
    render(<StorageSettingsForm onCleared={onCleared} />);

    act(() => buttonByText("Clear credentials").click());
    expect(mutateMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Clear storage credentials?");
    expect(document.body.textContent).toContain(
      "Uploads fail until you set up storage again. Existing files stay in uploads-example.",
    );

    const confirm = [...document.querySelectorAll("[role=alertdialog] button")]
      .reverse()
      .find((el) => el.textContent?.trim() === "Clear credentials") as
      | HTMLButtonElement
      | undefined;
    act(() => confirm!.click());
    expect(mutateMock).toHaveBeenCalledWith(
      { operation: "clear" },
      expect.anything(),
    );
    expect(onCleared).toHaveBeenCalledWith(emptyStatus);
  });

  it("says new uploads go to Builder.io when it is connected", () => {
    queryState.data = { ...savedStatus, builderUploadConfigured: true };
    render();
    act(() => buttonByText("Clear credentials").click());
    expect(document.body.textContent).toContain(
      "New uploads go to Builder.io storage. Existing files stay in uploads-example.",
    );
  });
});
