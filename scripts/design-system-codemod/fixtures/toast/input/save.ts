import { toast } from "sonner";

declare function save(): Promise<void>;
declare function undo(): void;
declare const t: (key: string) => string;

export async function run(name: string) {
  toast("Saved");
  toast.message(t("saved"), { description: name });
  toast.success(`Saved ${name}`, { duration: 2000, closeButton: true });
  toast.error("Could not save", {
    description: "Try again",
    duration: Infinity,
    important: true,
    richColors: true,
  });
  toast.warning("Offline", { position: "top-center" });
  toast.info(name ? "Named" : "Unnamed", { onDismiss: () => undo() });
  const id = toast.loading("Saving…");
  await save();
  toast.success("Done", { id });
  toast.dismiss(id);
  toast.dismiss();
}

export function withActions(name: string) {
  toast("Deleted", {
    action: { label: "Undo", onClick: () => undo() },
  });
  const restored = toast.success("Archived", {
    action: {
      label: "Undo",
      onClick: () => {
        undo();
        toast.success(`Restored ${name}`);
      },
    },
    cancel: { label: "Dismiss" },
  });
  toast.info("Synced", { id: "sync", action: { label: "Open", onClick: undo } });
  return restored;
}
