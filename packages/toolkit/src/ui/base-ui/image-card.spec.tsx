// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ImageCardTarget } from "./image-card.js";

afterEach(cleanup);

it("keeps native button targets from submitting their enclosing form unless requested", () => {
  const submit = vi.fn();
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ImageCardTarget>Default</ImageCardTarget>
      <ImageCardTarget render={<button />}>Element</ImageCardTarget>
      <ImageCardTarget render={(props) => <button {...props} />}>
        Callback
      </ImageCardTarget>
      <ImageCardTarget render={<button type="submit" />}>Save</ImageCardTarget>
      <ImageCardTarget render={<a href="#library" />}>Library</ImageCardTarget>
    </form>,
  );
  for (const name of ["Default", "Element", "Callback"]) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(submit).not.toHaveBeenCalled();
  }
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("link", { name: "Library" }).getAttribute("type"),
  ).toBeNull();
});
