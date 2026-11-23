import { notifyChatThreadsUpdated } from "@agent-native/core/client/agent-chat";
import { actionErrorCode, callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { stripAgentChatContextFromMessage } from "@agent-native/core/shared";
import type { AgentChatSurfaceProps } from "@agent-native/toolkit/app/chat";
import { useCallback, useRef, useState } from "react";
import type { z } from "zod";

import type resolveOpenProjectIntent from "../../../actions/resolve-open-project-intent";
import type uploadProjectFile from "../../../actions/upload-project-file";
import type {
  AnalyticsPrompt,
  StartThreadInput,
  pendingThreadBootstrap,
  startThreadReceipt,
  threadBindingRef,
  threadBootstrapRead,
} from "../../../shared/analytics-thread";
import {
  parseDashboardQuestion,
  parseOpenProjectIntent,
} from "../../../shared/open-project-intent";

type Binding = z.infer<typeof threadBindingRef>;
type StartReceipt = z.infer<typeof startThreadReceipt>;
type StartResult = StartReceipt | z.infer<typeof pendingThreadBootstrap>;
type BootstrapRead = z.infer<typeof threadBootstrapRead>;
type Admission = NonNullable<AgentChatSurfaceProps["admitComposerMessage"]>;
type UploadedFile = Awaited<ReturnType<typeof uploadProjectFile.run>>;
type OpenProjectIntent = Awaited<
  ReturnType<typeof resolveOpenProjectIntent.run>
>;
type FileUpload = {
  id: string;
  attachmentId?: string;
  pending?: Promise<string>;
};

export async function startAskThread(
  input: StartThreadInput,
): Promise<StartReceipt> {
  const isAccepted = (receipt: StartReceipt) =>
    input.trigger.kind === "attach" || receipt.phase === "submitted";
  let result: StartResult;
  try {
    result = await callAction<StartResult>("start-analytics-thread", input);
  } catch (error) {
    const code = actionErrorCode(error);
    if (code && code !== "admission_unreadable") throw error;
    const stored = await readBootstrap(input.intentId);
    if (stored.phase !== "ready" || !isAccepted(stored.receipt)) throw error;
    return stored.receipt;
  }
  if (result.phase !== "binding" && isAccepted(result)) return result;
  const stored = await readBootstrap(input.intentId);
  if (stored.phase === "ready" && isAccepted(stored.receipt))
    return stored.receipt;
  throw Object.assign(new Error(stored.phase), {
    code: stored.phase === "failed" ? stored.code : "binding",
  });
}

function readBootstrap(intentId: string) {
  return callAction<BootstrapRead>(
    "get-analytics-thread-bootstrap",
    { intentId },
    { method: "GET" },
  );
}

async function uploadFile(projectId: string, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const { file: uploaded } = await callAction<UploadedFile>(
    "upload-project-file",
    {
      projectId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      dataBase64: btoa(binary),
    },
  );
  return uploaded.id;
}

export function useAskThreadAdmission({
  binding,
  mode,
  goToThread,
  sourceId,
}: {
  binding: Binding | null;
  mode: StartThreadInput["mode"];
  goToThread: (href: string, options?: { state?: unknown }) => void;
  sourceId?: string | undefined;
}) {
  const t = useT();
  const [approval, setApproval] = useState<AnalyticsPrompt["approval"]>("ask");
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const files = useRef(new WeakMap<File, FileUpload>());
  const attach = useRef<{
    input: StartThreadInput;
    pending?: Promise<StartReceipt>;
    receipt?: StartReceipt;
  } | null>(null);
  const lastMessage = useRef<{ fingerprint: string; id: string } | null>(null);

  const prepareFiles = useCallback(
    (selected: readonly File[]) => {
      if (binding || selected.length === 0) return undefined;
      if (!attach.current) {
        attach.current = {
          input: {
            intentId: crypto.randomUUID(),
            mode,
            trigger: {
              kind: "attach",
              uploads: selected.map((file) => {
                const id = crypto.randomUUID();
                files.current.set(file, { id });
                return {
                  clientFileId: id,
                  name: file.name,
                  byteLength: file.size,
                  mime: file.type || "application/octet-stream",
                };
              }),
            },
          },
        };
      }
      const current = attach.current;
      current.pending ??= startAskThread(current.input).then(
        (receipt) => {
          current.receipt = receipt;
          notifyChatThreadsUpdated();
          return receipt;
        },
        (error: unknown) => {
          delete current.pending;
          throw error;
        },
      );
      return current.pending;
    },
    [binding, mode],
  );

  const upload = useCallback(
    (destination: Binding, attached: StartReceipt | undefined, file: File) => {
      const stored = files.current.get(file) ?? { id: crypto.randomUUID() };
      files.current.set(file, stored);
      const slot = attached?.uploadSlots.find(
        ({ clientFileId }) => clientFileId === stored.id,
      );
      const record = (attachment: string | null) =>
        slot
          ? callAction("record-analytics-thread-upload", {
              threadId: destination.threadId,
              uploadId: slot.uploadId,
              attachment,
            })
          : undefined;
      if (stored.pending) return stored.pending;
      stored.pending = (async () => {
        setUploading(file.name);
        try {
          stored.attachmentId ??= await uploadFile(destination.projectId, file);
          await record(stored.attachmentId);
          setFailedFile((failed) => (failed === file ? null : failed));
          return slot?.uploadId ?? stored.attachmentId;
        } catch (cause) {
          if (slot && !stored.attachmentId) {
            try {
              await record(null);
            } catch (error) {
              console.warn(
                "[analytics] Could not record the failed upload",
                error,
              );
            }
          }
          delete stored.pending;
          setFailedFile(file);
          throw Object.assign(
            new Error(t("analytics.ask.uploadFailed", { file: file.name })),
            {
              errorCode: "analytics_upload_failed",
              cause,
            },
          );
        } finally {
          setUploading(null);
        }
      })();
      return stored.pending;
    },
    [t],
  );

  const uploadSelected = useCallback(
    async (selected: readonly File[]) => {
      const attached =
        (await prepareFiles(selected)) ?? attach.current?.receipt;
      const destination = binding ?? attached;
      if (!destination) return { destination, attachmentIds: [] };
      const attachmentIds: string[] = [];
      for (const file of selected)
        attachmentIds.push(await upload(destination, attached, file));
      return { destination, attachmentIds };
    },
    [binding, prepareFiles, upload],
  );

  const onAttachmentsChange = useCallback(
    (selected: File[]) => {
      setFailedFile((failed) =>
        failed && !selected.includes(failed) ? null : failed,
      );
      if (!selected.length) return;
      void uploadSelected(selected).catch((error: unknown) => {
        const code = actionErrorCode(error);
        if (
          code !== "ai_provider_unavailable" &&
          code !== "analytics_upload_failed"
        ) {
          console.warn(
            "[analytics] Could not prepare the thread attachment",
            error,
          );
        }
      });
    },
    [uploadSelected],
  );

  const retryUpload = async () => {
    if (failedFile) await uploadSelected([failedFile]);
  };

  const admit: Admission = async ({
    text,
    files: selected,
    model,
    validateScope,
  }) => {
    const opening = !binding;
    if (opening) setStarting(true);
    setFailedFile(null);
    try {
      const plainText = stripAgentChatContextFromMessage(text);
      const canLand = opening && selected.length === 0;
      const openTitle = canLand ? parseOpenProjectIntent(plainText) : null;
      const askedTitle =
        canLand && !openTitle ? parseDashboardQuestion(plainText) : null;
      const lookup = openTitle ?? askedTitle;
      if (lookup) {
        const found = await callAction<OpenProjectIntent>(
          "resolve-open-project-intent",
          askedTitle
            ? { title: lookup, question: plainText }
            : { title: lookup },
          { method: "GET" },
        ).catch(() => null);
        if (found?.status === "found") {
          validateScope();
          if (askedTitle)
            goToThread(found.href, { state: { askQuestion: plainText } });
          else goToThread(found.href);
          return { threadId: "" };
        }
      }
      const { destination, attachmentIds } = await uploadSelected(selected);
      validateScope();
      setUploading(null);
      const prompt: AnalyticsPrompt = {
        text: stripAgentChatContextFromMessage(text),
        attachmentIds,
        mentions: [],
        sourceIds: sourceId ? [sourceId] : [],
        ...(model ? { modelId: model } : {}),
        approval,
      };
      const fingerprint = JSON.stringify([destination?.threadId, mode, prompt]);
      if (lastMessage.current?.fingerprint !== fingerprint) {
        lastMessage.current = { fingerprint, id: crypto.randomUUID() };
      }
      const messageId = lastMessage.current.id;
      let admitted: Binding;
      if (destination) {
        await callAction("submit-analytics-thread-turn", {
          threadId: destination.threadId,
          messageId,
          prompt,
        });
        admitted = destination;
      } else {
        admitted = await startAskThread({
          intentId: messageId,
          mode,
          trigger: { kind: "submit", prompt },
        });
      }
      lastMessage.current = null;
      if (opening) goToThread(admitted.href);
      notifyChatThreadsUpdated();
      return admitted;
    } catch (cause) {
      const code = actionErrorCode(cause);
      if (code === "analytics_upload_failed") throw cause;
      if (code === "ai_provider_unavailable") {
        window.dispatchEvent(new Event("agent-engine:configured-changed"));
        throw new Error(t("analytics.ask.connectAiMessage"), { cause });
      }
      throw new Error(t("analytics.ask.admissionFailed"), { cause });
    } finally {
      setStarting(false);
      setUploading(null);
    }
  };

  return {
    approval,
    setApproval,
    admit,
    onAttachmentsChange,
    starting,
    uploading,
    failedFile,
    retryUpload,
  };
}
