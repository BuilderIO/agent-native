import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFolder, IconX } from "@tabler/icons-react";
import { useId, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type CollectionRole = "member" | "manager";
type Person = { email: string; role: CollectionRole };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLLECTION_EMOJIS = [
  "📁",
  "📊",
  "📈",
  "🧪",
  "🔍",
  "💡",
  "🚀",
  "⭐",
  "📌",
  "🗂️",
  "💼",
  "🎯",
] as const;

function RolePicker({
  value,
  label,
  disabled,
  onChange,
}: {
  value: CollectionRole;
  label: string;
  disabled?: boolean;
  onChange: (role: CollectionRole) => void;
}) {
  const t = useT();
  return (
    <Select
      value={value}
      disabled={disabled === true}
      onValueChange={(next) => onChange(next as CollectionRole)}
    >
      <SelectTrigger aria-label={label} className="h-8 w-32 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="member">
          {t("collectionDialog.roleMember")}
        </SelectItem>
        <SelectItem value="manager">
          {t("collectionDialog.roleManager")}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function NewCollectionDialog({
  onClose,
  collection,
}: {
  onClose: (createdId?: string) => void;
  /** Present when editing an existing collection instead of creating one. */
  collection?:
    | {
        id: string;
        name: string;
        description: string;
        emoji?: string | null | undefined;
      }
    | undefined;
}) {
  const t = useT();
  const id = useId();
  const editing = collection !== undefined;
  const opener = useRef<Element | null>(null);
  if (opener.current === null) opener.current = document.activeElement;
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [emoji, setEmoji] = useState<string | null>(collection?.emoji ?? null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [shareWorkspace, setShareWorkspace] = useState(false);
  const [workspaceRole, setWorkspaceRole] = useState<CollectionRole>("member");
  const [people, setPeople] = useState<Person[]>([]);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addPerson() {
    const next = email.trim().toLowerCase();
    if (next === "") return;
    if (!EMAIL.test(next)) {
      setEmailError(t("collectionDialog.invalidEmail"));
      return;
    }
    if (people.some((person) => person.email === next)) {
      setEmailError(t("collectionDialog.alreadyAdded", { email: next }));
      return;
    }
    setPeople([...people, { email: next, role: "member" }]);
    setEmail("");
    setEmailError(null);
  }

  async function submit() {
    if (pending || name.trim() === "") return;
    if (email.trim() !== "") {
      setEmailError(t("collectionDialog.pendingEmail"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      let createdId: string | undefined;
      if (collection === undefined) {
        const sharing = {
          ...(shareWorkspace ? { workspaceRole } : {}),
          ...(people.length > 0 ? { users: people } : {}),
        };
        const created = await callAction("create-collection", {
          name: name.trim(),
          ...(description.trim() === ""
            ? {}
            : { description: description.trim() }),
          ...(emoji === null ? {} : { emoji }),
          ...(Object.keys(sharing).length > 0 ? { sharing } : {}),
        });
        createdId = created.id;
      } else {
        await callAction("update-collection", {
          collectionId: collection.id,
          name: name.trim(),
          description: description.trim(),
          ...(collection.emoji !== undefined || emoji !== null
            ? { emoji }
            : {}),
        });
      }
      onClose(createdId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : editing
            ? t("collectionDialog.saveError")
            : t("collectionDialog.createError"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          const target = opener.current;
          if (target instanceof HTMLElement && target.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("collectionDialog.editTitle")
                : t("collectionDialog.createTitle")}
            </DialogTitle>
          </DialogHeader>
          <label
            className="mt-4 block text-xs font-medium text-muted-foreground"
            htmlFor="analytics-collection-name"
          >
            {t("collectionDialog.name")}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("org.emoji")}
                  disabled={pending}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-sm text-foreground hover:bg-muted"
                >
                  {emoji ?? (
                    <IconFolder
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div className="grid grid-cols-6 gap-1">
                  {COLLECTION_EMOJIS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-label={option}
                      aria-pressed={emoji === option}
                      className={
                        emoji === option
                          ? "flex h-8 w-8 items-center justify-center rounded bg-accent text-base"
                          : "flex h-8 w-8 items-center justify-center rounded text-base hover:bg-muted"
                      }
                      onClick={() => {
                        setEmoji(option);
                        setEmojiOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {emoji !== null ? (
                  <button
                    type="button"
                    className="mt-2 w-full rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      setEmoji(null);
                      setEmojiOpen(false);
                    }}
                  >
                    {t("org.removeIcon")}
                  </button>
                ) : null}
              </PopoverContent>
            </Popover>
            <input
              id="analytics-collection-name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={name}
              maxLength={200}
              autoFocus
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <label
            className="mt-3 block text-xs font-medium text-muted-foreground"
            htmlFor={`${id}-description`}
          >
            {t("collectionDialog.description")}
          </label>
          <textarea
            id={`${id}-description`}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            rows={2}
            maxLength={2000}
            disabled={pending}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {editing ? null : (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label
                  className="text-sm text-foreground"
                  htmlFor={`${id}-workspace`}
                >
                  {t("collectionDialog.shareWithWorkspace")}
                </label>
                <div className="flex items-center gap-2">
                  {shareWorkspace ? (
                    <RolePicker
                      value={workspaceRole}
                      label={t("collectionDialog.workspaceRole")}
                      disabled={pending}
                      onChange={setWorkspaceRole}
                    />
                  ) : null}
                  <Switch
                    id={`${id}-workspace`}
                    checked={shareWorkspace}
                    disabled={pending}
                    onCheckedChange={setShareWorkspace}
                  />
                </div>
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-muted-foreground"
                  htmlFor={`${id}-email`}
                >
                  {t("collectionDialog.sharePeople")}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id={`${id}-email`}
                    type="email"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    placeholder={t("collectionDialog.emailPlaceholder")}
                    value={email}
                    disabled={pending}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setEmailError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addPerson();
                    }}
                  />
                  <button
                    type="button"
                    className="rounded border border-border px-3 py-1.5 text-sm"
                    disabled={pending || email.trim() === ""}
                    onClick={addPerson}
                  >
                    {t("collectionDialog.addPerson")}
                  </button>
                </div>
                {emailError != null ? (
                  <p
                    className="mt-1 text-xs text-[color:var(--ws-danger)]"
                    role="alert"
                  >
                    {emailError}
                  </p>
                ) : null}
              </div>
              {people.map((person) => (
                <div
                  key={person.email}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-sm text-foreground">
                    {person.email}
                  </span>
                  <div className="flex items-center gap-2">
                    <RolePicker
                      value={person.role}
                      label={t("collectionDialog.roleFor", {
                        email: person.email,
                      })}
                      disabled={pending}
                      onChange={(role) =>
                        setPeople(
                          people.map((entry) =>
                            entry.email === person.email
                              ? { ...entry, role }
                              : entry,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs"
                      aria-label={t("collectionDialog.removePerson", {
                        email: person.email,
                      })}
                      disabled={pending}
                      onClick={() =>
                        setPeople(
                          people.filter(
                            (entry) => entry.email !== person.email,
                          ),
                        )
                      }
                    >
                      <IconX className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {error != null ? (
            <p
              className="mt-2 text-xs text-[color:var(--ws-danger)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="mt-5">
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-sm"
              onClick={() => onClose()}
            >
              {t("collectionDialog.cancel")}
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              disabled={pending || name.trim() === ""}
              aria-disabled={email.trim() !== "" ? true : undefined}
              title={
                email.trim() !== ""
                  ? t("collectionDialog.pendingEmail")
                  : undefined
              }
              aria-busy={pending}
            >
              {editing
                ? t("collectionDialog.save")
                : t("collectionDialog.create")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
