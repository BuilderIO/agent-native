// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotebookEmptyState } from "./NotebookEmptyState";

/**
 * Row 585: the notebook empty state used to render "Browse all data", "Search
 * for data" and "Upload a CSV" as disabled chips whenever the route had no
 * handler for them. A disabled chip is a control that does nothing, so the
 * chip is pulled instead of shipped dead — and the one action the route can
 * back still renders.
 */
const base = {
  connections: [],
};

describe("notebook empty state actions", () => {
  it("renders no action chip when the route backs none of them", () => {
    const html = renderToStaticMarkup(
      <NotebookEmptyState {...base} emptyState={{}} />,
    );
    expect(html).not.toContain("Browse all data");
    expect(html).not.toContain("Search for data");
    expect(html).not.toContain("Upload a CSV");
  });

  it("renders only the action the route backs", () => {
    const html = renderToStaticMarkup(
      <NotebookEmptyState
        {...base}
        emptyState={{ onBrowseAllData: () => {} }}
      />,
    );
    expect(html).toContain("Browse all data");
    expect(html).not.toContain("Upload a CSV");
    expect(html).not.toContain("Search for data");
  });

  it("renders the CSV action once a handler exists", () => {
    const html = renderToStaticMarkup(
      <NotebookEmptyState {...base} emptyState={{ onUploadCsv: () => {} }} />,
    );
    expect(html).toContain("Upload a CSV");
    expect(html).not.toContain("Browse all data");
  });

  it("shows the default workspace connection name when multiple connections exist", () => {
    const html = renderToStaticMarkup(
      <NotebookEmptyState
        connections={[
          { id: "conn_1", name: "Non-default connection", isDefault: false },
          { id: "conn_2", name: "Default warehouse", isDefault: true },
        ]}
        emptyState={{}}
      />,
    );
    expect(html).toContain("Default warehouse");
    expect(html).not.toContain("Non-default connection");
  });

  it("renders Recently Used and Favorites sections with empty copy when no datasets exist", () => {
    const html = renderToStaticMarkup(
      <NotebookEmptyState {...base} emptyState={{}} />,
    );
    expect(html).toContain("Recently Used");
    expect(html).toContain("No recently used tables");
    expect(html).toContain("Favorites");
    expect(html).toContain("No favorited data");
  });

  it("renders recent and favorite dataset items when provided", () => {
    const html = renderToStaticMarkup(
      <NotebookEmptyState
        {...base}
        emptyState={{
          recentDatasets: [{ id: "tbl_1", name: "orders" }],
          favoriteDatasets: [{ id: "tbl_2", name: "customers" }],
          onOpenDataset: () => {},
        }}
      />,
    );
    expect(html).toContain("orders");
    expect(html).toContain("customers");
    expect(html).not.toContain("No recently used tables");
    expect(html).not.toContain("No favorited data");
  });
});
