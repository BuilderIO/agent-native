import { expect, it, vi } from "vitest";

import {
  activateMobileTab,
  getCurrentMobileTabRouteName,
} from "./mobile-app-navigation";

it("opens custom app tabs through the dynamic tab route", () => {
  const navigate = vi.fn();
  const navigateToTab = vi.fn();
  const emit = vi.fn(() => ({ defaultPrevented: false }));
  for (const id of ["custom-notes", "workspace-app", "custom notes"]) {
    activateMobileTab({
      routeName: `tab-app/${encodeURIComponent(id)}`,
      appId: id,
      routes: [{ name: "tab-app/[id]", key: "dynamic" }],
      currentIndex: 0,
      emit,
      navigateToTab,
      navigate,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      `/tab-app/${encodeURIComponent(id)}`,
    );
    expect(
      getCurrentMobileTabRouteName({ name: "tab-app/[id]", params: { id } }),
    ).toBe(`tab-app/${encodeURIComponent(id)}`);
  }
  expect(emit).not.toHaveBeenCalled();
  expect(navigateToTab).not.toHaveBeenCalled();
});

it("uses the existing tab navigator for registered routes", () => {
  const navigate = vi.fn();
  const navigateToTab = vi.fn();
  const emit = vi.fn(() => ({ defaultPrevented: false }));
  activateMobileTab({
    routeName: "mail",
    routes: [
      { name: "chat", key: "chat" },
      { name: "mail", key: "mail" },
    ],
    currentIndex: 0,
    emit,
    navigateToTab,
    navigate,
  });
  expect(emit).toHaveBeenCalledWith("mail");
  expect(navigateToTab).toHaveBeenCalledWith("mail");
  expect(navigate).not.toHaveBeenCalled();
});

it("respects a prevented tab press", () => {
  const navigateToTab = vi.fn();
  activateMobileTab({
    routeName: "mail",
    routes: [
      { name: "chat", key: "chat" },
      { name: "mail", key: "mail" },
    ],
    currentIndex: 0,
    emit: () => ({ defaultPrevented: true }),
    navigateToTab,
    navigate: vi.fn(),
  });
  expect(navigateToTab).not.toHaveBeenCalled();
});
