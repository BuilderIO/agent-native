import { toast } from "@agent-native/toolkit/ui/base-ui/toast";

declare function save(): Promise<void>;
declare function undo(): void;
declare const t: (key: string) => string;

export async function run(name: string) {
  toast.add({ title: "Saved" });
  toast.add({ title: t("saved"), description: name });
  toast.add({ title: `Saved ${name}`, color: "success", timeout: 2000 });
  toast.add({
    title: "Could not save",
    color: "danger",
    description: "Try again",
    timeout: 0,
    priority: "high",
  });
  toast.add({ title: "Offline", color: "warning" });
  toast.add({
    title: name ? "Named" : "Unnamed",
    color: "info",
    onClose: () => undo(),
  });
  const id = toast.add({ title: "Saving…", type: "loading" });
  await save();
  toast.add({ title: "Done", color: "success", id });
  toast.close(id);
  toast.close();
}

export function withActions(name: string) {
  const toastId = toast.add({
    title: "Deleted",
    actionProps: {
      children: "Undo",
      onClick: () => {
        toast.close(toastId);
        undo();
      },
    },
  });
  const restored = toast.add({
    title: "Archived",
    color: "success",
    actionProps: {
      children: "Undo",
      onClick: () => {
        toast.close(restored);
        undo();
        toast.add({ title: `Restored ${name}`, color: "success" });
      },
    },
    secondaryActionProps: {
      children: "Dismiss",
      onClick: () => toast.close(restored),
    },
  });
  toast.add({
    title: "Synced",
    color: "info",
    id: "sync",
    actionProps: {
      children: "Open",
      onClick: () => {
        toast.close("sync");
        undo();
      },
    },
  });
  return restored;
}
