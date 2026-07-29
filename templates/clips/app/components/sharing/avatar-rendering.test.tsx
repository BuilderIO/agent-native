// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar as ShareAvatar } from "./share-ui";
import { ViewerAvatar } from "./viewed-by-popover";

const avatarMocks = vi.hoisted(() => ({
  emails: [] as Array<string | null | undefined>,
  intersections: [] as IntersectionObserverCallback[],
  url: null as string | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => ({ data: undefined, isLoading: false }),
  useAvatarUrl: (email: string | null | undefined) => {
    avatarMocks.emails.push(email);
    return email ? avatarMocks.url : null;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: React.forwardRef<
    HTMLSpanElement,
    React.HTMLAttributes<HTMLSpanElement>
  >(({ children, ...props }, ref) => (
    <span ref={ref} {...props}>
      {children}
    </span>
  )),
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
  AvatarFallback: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}));

describe("sharing avatar rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    avatarMocks.emails = [];
    avatarMocks.intersections = [];
    avatarMocks.url = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          avatarMocks.intersections.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(node: React.ReactElement) {
    act(() => root.render(node));
  }

  function revealAvatar(index = 0) {
    act(() => {
      avatarMocks.intersections[index]?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  }

  it("renders a stored profile image in the share list once visible", () => {
    avatarMocks.url = "data:image/jpeg;base64,share-avatar";

    render(<ShareAvatar label="person@example.com" />);

    expect(avatarMocks.emails).toEqual([null]);
    expect(container.querySelector("img")).toBeNull();

    revealAvatar();

    expect(avatarMocks.emails).toEqual([null, "person@example.com"]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      avatarMocks.url,
    );
  });

  it("defers a new email when an avatar instance is reused", () => {
    avatarMocks.url = "data:image/jpeg;base64,reused-avatar";

    render(<ShareAvatar label="first@example.com" />);
    revealAvatar();
    expect(avatarMocks.emails).toEqual([null, "first@example.com"]);

    render(<ShareAvatar label="second@example.com" />);

    expect(avatarMocks.emails).toEqual([null, "first@example.com", null]);
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps organization shares on the group fallback", () => {
    render(<ShareAvatar label="organization-id" org />);

    expect(avatarMocks.emails).toEqual([null]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a stored profile image in viewed-by rows once visible", () => {
    avatarMocks.url = "data:image/jpeg;base64,viewer-avatar";

    render(
      <ViewerAvatar
        email="viewer@example.com"
        name="Viewer Name"
        label="Viewer Name"
      />,
    );

    expect(avatarMocks.emails).toEqual([null]);
    expect(container.querySelector("img")).toBeNull();

    revealAvatar();

    expect(avatarMocks.emails).toEqual([null, "viewer@example.com"]);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(avatarMocks.url);
    expect(image?.getAttribute("alt")).toBe("Viewer Name");
  });
});
