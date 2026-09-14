// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { useDeleteForm, useSubmitForm } from "./use-forms";

type FormListItem = { id: string; title: string };

function Probe({ onReady }: { onReady: (mutation: any) => void }) {
  onReady(useDeleteForm());
  return null;
}

describe("useDeleteForm", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function renderProbe(
    queryClient: QueryClient,
    onReady: (mutation: any) => void,
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Probe onReady={onReady} />
        </QueryClientProvider>,
      );
    });
  }

  function seedLists(queryClient: QueryClient) {
    const active: FormListItem[] = [
      { id: "form-1", title: "First" },
      { id: "form-2", title: "Second" },
    ];
    const archived: FormListItem[] = [{ id: "form-3", title: "Archived" }];
    queryClient.setQueryData(["action", "list-forms", {}], active);
    queryClient.setQueryData(
      ["action", "list-forms", { archived: true }],
      archived,
    );
    return { active, archived };
  }

  it("removes an active form before the archive action resolves", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { archived } = seedLists(queryClient);
    let mutation: any;
    renderProbe(queryClient, (value) => {
      mutation = value;
    });

    let result: Promise<unknown> | undefined;
    await act(async () => {
      result = mutation.mutateAsync({ id: "form-1" });
    });
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(["action", "list-forms", {}])).toEqual([
        { id: "form-2", title: "Second" },
      ]);
    });
    expect(
      queryClient.getQueryData(["action", "list-forms", { archived: true }]),
    ).toEqual(archived);

    await act(async () => {
      resolveFetch?.(
        new Response(JSON.stringify({ success: true, purged: false }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await result;
    });
  });

  it("restores the active form when archiving fails", async () => {
    let rejectFetch: ((error: Error) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { active } = seedLists(queryClient);
    let mutation: any;
    renderProbe(queryClient, (value) => {
      mutation = value;
    });

    const result = mutation.mutateAsync({ id: "form-1" });
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(["action", "list-forms", {}])).toEqual([
        { id: "form-2", title: "Second" },
      ]);
    });

    rejectFetch?.(new Error("network failure"));
    await expect(result).rejects.toThrow();
    expect(queryClient.getQueryData(["action", "list-forms", {}])).toEqual(
      active,
    );
  });

  it("sends a scrubbed current page URL with public submissions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      {},
      "",
      "/f/feedback?utm_source=newsletter&token=example-token",
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    let mutation: any;
    function SubmitProbe({ onReady }: { onReady: (value: any) => void }) {
      onReady(useSubmitForm());
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <SubmitProbe onReady={(value) => (mutation = value)} />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await mutation.mutateAsync({
        formId: "form-1",
        data: { message: "hello" },
      });
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body),
    );
    expect(body._meta.pageUrl).toContain("utm_source=newsletter");
    expect(body._meta.pageUrl).toContain("token=%3Credacted%3E");
  });

  it("uploads selected files before submitting public form data", async () => {
    const file = new File(["image"], "screen.png", { type: "image/png" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: "https://files.example/screen.png",
            name: file.name,
            type: file.type,
            size: file.size,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    let mutation: any;
    function SubmitProbe({ onReady }: { onReady: (value: any) => void }) {
      onReady(useSubmitForm());
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <SubmitProbe onReady={(value) => (mutation = value)} />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await mutation.mutateAsync({
        formId: "form-1",
        data: { attachments: [file], message: "hello" },
      });
    });

    // Match this flow's own requests by URL rather than asserting a global
    // call count: an unrelated queued request from an earlier test in this file
    // can land on this stub and made the count assertion flake.
    const flowCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/form-1"),
    ) as Array<[string, RequestInit]>;
    const uploadCalls = flowCalls.filter(([url]) =>
      url.includes("/api/upload/form-1"),
    );
    const submitCalls = flowCalls.filter(([url]) =>
      url.includes("/api/submit/form-1"),
    );
    expect(uploadCalls).toHaveLength(1);
    expect(submitCalls).toHaveLength(1);
    const [uploadUrl, uploadRequest] = uploadCalls[0]!;
    expect(uploadUrl).toContain("/api/upload/form-1");
    expect(uploadRequest.method).toBe("POST");
    expect(uploadRequest.body).toBeInstanceOf(FormData);
    const uploadBody = uploadRequest.body as FormData;
    expect(uploadBody.get("fieldId")).toBe("attachments");
    expect((uploadBody.get("file") as File).name).toBe(file.name);

    const [, submitRequest] = submitCalls[0]!;
    const submitted = JSON.parse(submitRequest.body as string);
    expect(submitted.data).toMatchObject({
      attachments: [
        {
          url: "https://files.example/screen.png",
          name: file.name,
        },
      ],
      message: "hello",
    });
  });
});
