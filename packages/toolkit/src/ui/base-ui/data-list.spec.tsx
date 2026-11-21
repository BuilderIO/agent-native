// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DataList,
  DataListItem,
  DataListLabel,
  type DataListProps,
  DataListValue,
} from "./data-list.js";

afterEach(cleanup);

function Details(props: DataListProps) {
  return (
    <DataList data-testid="list" {...props}>
      <DataListItem>
        <DataListLabel>Status</DataListLabel>
        <DataListValue>Running</DataListValue>
      </DataListItem>
    </DataList>
  );
}

describe("Data List part", () => {
  it("is a description list, horizontal untrimmed by default", () => {
    render(<Details />);
    const list = screen.getByTestId("list");
    expect(list.tagName).toBe("DL");
    expect(list.className).toBe("data-list");
    expect(list.dataset.orientation).toBe("horizontal");
    expect(list.dataset.trim).toBeUndefined();
  });

  it("writes the orientation and trim it is given", () => {
    render(<Details orientation="vertical" trim="both" />);
    const list = screen.getByTestId("list");
    expect(list.dataset.orientation).toBe("vertical");
    expect(list.dataset.trim).toBe("both");
  });

  it("pairs each label and value as a term and its definition", () => {
    render(<Details />);
    const term = screen.getByRole("term");
    expect(term.tagName).toBe("DT");
    expect(term.className).toBe("data-list-label");
    expect(term.parentElement?.className).toBe("data-list-item");
    const definition = screen.getByRole("definition");
    expect(definition.tagName).toBe("DD");
    expect(definition.className).toBe("data-list-value");
  });

  it("refuses an orientation it doesn't have", () => {
    const props = { orientation: "inline" } as unknown as DataListProps;
    expect(() => render(<Details {...props} />)).toThrow(
      /orientation="inline" is not one of/,
    );
  });
});
