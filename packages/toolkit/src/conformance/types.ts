import type { DesignSystemComponents } from "../design-system/types.js";

export type DesignSystemConformanceCategory =
  | "contract"
  | "leaf"
  | "behavior"
  | "overlay-interoperability";

export interface DesignSystemConformanceCheckResult {
  id: string;
  category: DesignSystemConformanceCategory;
  components: readonly (keyof DesignSystemComponents)[];
  passed: boolean;
  message?: string;
}

export interface DesignSystemConformanceReport {
  contractVersion: number;
  adapterName: string;
  passed: boolean;
  results: readonly DesignSystemConformanceCheckResult[];
}

export interface RunDesignSystemConformanceOptions {
  adapterName?: string;
  components: DesignSystemComponents;
  contractVersion: number;
  document?: Document;
}

export class DesignSystemConformanceError extends Error {
  readonly report: DesignSystemConformanceReport;

  constructor(report: DesignSystemConformanceReport) {
    const failures = report.results
      .filter((result) => !result.passed)
      .map((result) => `${result.id}: ${result.message ?? "failed"}`)
      .join("\n");
    super(
      `Design system conformance failed for ${report.adapterName}:\n${failures}`,
    );
    this.name = "DesignSystemConformanceError";
    this.report = report;
  }
}
