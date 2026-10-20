import type { RecorderReport } from "./recorder.js";
import { actionErrorMessage, callAction } from "./use-action.js";

export {
  countRecorderEventsByType,
  formatProblemReportSummary,
  formatRecorderEvent,
  isFailedRecorderEvent,
} from "../problem-report/format.js";

export type ProblemReportUpload =
  | { status: "ok"; ref: string }
  | { status: "failed"; errorCode?: string; message?: string };

export async function uploadProblemReport(
  report: RecorderReport,
): Promise<ProblemReportUpload> {
  try {
    const { ref } = await callAction<{ ref: string }>("save-problem-report", {
      report,
    });
    return { status: "ok", ref };
  } catch (error) {
    const errorCode = (error as { errorCode?: unknown }).errorCode;
    const message = actionErrorMessage(error);
    return {
      status: "failed",
      ...(typeof errorCode === "string" ? { errorCode } : {}),
      ...(message ? { message } : {}),
    };
  }
}
