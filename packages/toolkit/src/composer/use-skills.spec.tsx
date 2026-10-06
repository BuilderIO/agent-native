// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({
  resolvePath: vi.fn((path: string) => `/design${path}`),
  translate: vi.fn((key: string, options?: Record<string, unknown>) =>
    typeof options?.defaultValue === "string" ? options.defaultValue : key,
  ),
}));

vi.mock("./runtime-adapters.js", () => ({
  useComposerRuntimeAdapters: () => adapters,
}));

import { useSkills } from "./use-skills.js";

let container: HTMLDivElement;
let root: Root;

function Harness({ enabled }: { enabled: boolean }) {
  const { skills, hint, isLoading } = useSkills(enabled);
  return (
    <div>
      {isLoading ? "Loading" : null}
      {skills.map((skill) => (
        <span key={skill.path}>{skill.name}</span>
      ))}
      {hint}
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useSkills", () => {
  it("loads runtime skills through the app-scoped skills route when enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          {
            name: "design-systems",
            description: "Create design systems",
            path: ".agents/skills/design-systems/SKILL.md",
            source: "codebase",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<Harness enabled />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/design/_agent-native/agent-chat/skills",
      { signal: expect.any(AbortSignal) },
    );
    expect(container.textContent).toContain("design-systems");
  });

  it("shows a retryable state instead of treating a failed route as an empty skill list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    act(() => root.render(<Harness enabled />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain(
      "Couldn't load skills. Close and reopen the menu to try again.",
    );
    expect(container.textContent).not.toContain("No skills available");
  });

  it("shows the same unavailable state for a malformed skills response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    act(() => root.render(<Harness enabled />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain(
      "Couldn't load skills. Close and reopen the menu to try again.",
    );
    expect(container.textContent).not.toContain("No skills available");
  });

  it("does not request skills until the slash menu is enabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<Harness enabled={false} />));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears previous app skills and aborts requests when the resolver changes or the menu closes", async () => {
    const originalResolver = adapters.resolvePath;
    const skill = {
      name: "private-skill",
      path: "skills/private/SKILL.md",
      source: "resource",
    };
    let complete!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ skills: [skill] })))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await act(async () => root.render(<Harness enabled />));
      expect(container.textContent).toContain("private-skill");
      adapters.resolvePath = vi.fn((path: string) => `/other${path}`);
      await act(async () => root.render(<Harness enabled />));
      expect(container.textContent).not.toContain("private-skill");
      expect(container.textContent).toContain("Loading");
      const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
      await act(async () => root.render(<Harness enabled={false} />));
      expect(signal.aborted).toBe(true);
      await act(async () =>
        complete(new Response(JSON.stringify({ skills: [skill] }))),
      );
      expect(container.textContent).toBe("");
    } finally {
      adapters.resolvePath = originalResolver;
    }
  });
});
