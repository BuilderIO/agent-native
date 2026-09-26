import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import { DialogFooter } from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconUserPlus,
  IconX,
  IconFileImport,
  IconPlus,
} from "@tabler/icons-react";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

// Type-only: erased at build time, so declaring app roles pulls no server or
// database code into the browser bundle.
import type { AppRolesDescriptor } from "../../org/app-roles.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { useBulkInviteMembers, type InviteRole } from "./hooks.js";
import { DialogErrorAlert, PendingLabel } from "./TeamPrimitives.js";

interface DraftInvite {
  email: string;
  role: InviteRole;
  appRoles?: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseCsvEmails(text: string): string[] {
  // Tolerant CSV parse — split on lines, then on commas, take any cell
  // that looks like an email. Handles "name,email,role" rows or just
  // "email" per line. A robust full CSV parser would be overkill here.
  const cells: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const cell of line.split(",")) {
      const trimmed = cell.trim().replace(/^"|"$/g, "");
      if (trimmed) cells.push(trimmed);
    }
  }
  return Array.from(
    new Set(cells.filter((c) => EMAIL_RE.test(c)).map((c) => c.toLowerCase())),
  );
}

function InviteAppRolePicker({
  appRoles,
  selected,
  onChange,
}: {
  appRoles: AppRolesDescriptor;
  selected: string[];
  onChange: (roles: string[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const labelFor = (role: string) => appRoles.roleLabels?.[role] ?? role;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" className="max-w-40">
          <span className="truncate">
            {selected.length
              ? selected.map(labelFor).join(", ")
              : t("org.appRolesOptional")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <Command>
          <CommandList>
            <CommandEmpty>{t("org.noAppRolesFound")}</CommandEmpty>
            <CommandGroup>
              {appRoles.roles.map((role) => {
                const checked = selected.includes(role);
                return (
                  <CommandItem
                    key={role}
                    value={role}
                    className="gap-2"
                    onSelect={() =>
                      onChange(
                        checked
                          ? selected.filter((item) => item !== role)
                          : [...selected, role],
                      )
                    }
                  >
                    <Checkbox checked={checked} aria-label={labelFor(role)} />
                    <span>{labelFor(role)}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const PASTE_PLACEHOLDER = "alice@acme.com, bob@acme.com\ncharlie@acme.com";

export function BulkInviteForm({
  currentUserRole,
  emailConfigured,
  appRoles,
  onClose,
}: {
  currentUserRole: string | null;
  emailConfigured?: boolean;
  appRoles?: AppRolesDescriptor;
  onClose: () => void;
}) {
  const t = useT();
  const bulkInvite = useBulkInviteMembers();
  const fileRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();
  const [drafts, setDrafts] = useState<DraftInvite[]>([
    { email: "", role: "member" },
  ]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteRole, setPasteRole] = useState<InviteRole>("member");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [result, setResult] = useState<{
    succeeded: number;
    allEmailed: boolean;
    failed: Map<string, string>;
  } | null>(null);

  const canSetAdmin = currentUserRole === "owner";
  const ownerOnlyAdmin = canSetAdmin
    ? undefined
    : t("agentChat.settingsOrg.invite.ownerOnlyAdmin");
  const emailId = (index: number) => `${idPrefix}-email-${index}`;
  const noteId = `${idPrefix}-note`;
  const savedMessage = (count: number, allEmailed: boolean) =>
    allEmailed
      ? t("agentChat.settingsOrg.invite.sent", { count })
      : t("agentChat.settingsOrg.invite.saved", { count });

  const validDrafts = useMemo(
    () =>
      drafts
        .map((d) => ({ ...d, email: d.email.trim().toLowerCase() }))
        .filter((d) => EMAIL_RE.test(d.email)),
    [drafts],
  );

  function setDraft(index: number, patch: Partial<DraftInvite>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function appendEmails(emails: string[], role: InviteRole) {
    if (!emails.length) return;
    setDrafts((prev) => {
      const existing = new Set(
        prev.map((d) => d.email.trim().toLowerCase()).filter(Boolean),
      );
      const fresh: DraftInvite[] = [];
      for (const e of emails) {
        if (!existing.has(e)) {
          fresh.push({ email: e, role });
          existing.add(e);
        }
      }
      // If the only existing row is an empty placeholder, drop it.
      const cleaned = prev.filter(
        (d, i) => !(i === 0 && !d.email.trim() && prev.length === 1),
      );
      return [...cleaned, ...fresh];
    });
  }

  function handleFile(file: File) {
    setCsvError(null);
    void file.text().then((text) => {
      const emails = parseCsvEmails(text);
      if (emails.length) appendEmails(emails, "member");
      else setCsvError(t("agentChat.settingsOrg.invite.csvNoEmails"));
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bulkInvite.isPending) return;
    setShowInvalid(true);
    setResult(null);
    const dedup = new Map<string, DraftInvite>();
    for (const d of validDrafts) {
      // Mirrors createInvitationHandler, which refuses an admin invite from
      // anyone but the owner.
      const role = canSetAdmin ? d.role : "member";
      dedup.set(d.email, { ...d, role });
    }
    // The server reads a defined appId as an app-role assignment, so an invite
    // with no roles picked must leave both out.
    const invites = Array.from(dedup.values()).map((invite) =>
      invite.appRoles?.length && appRoles
        ? { ...invite, appId: appRoles.appId, appRoles: invite.appRoles }
        : { ...invite, appRoles: undefined },
    );
    if (invites.length === 0) return;

    let response: Awaited<ReturnType<typeof bulkInvite.mutateAsync>>;
    try {
      response = await bulkInvite.mutateAsync(invites);
    } catch {
      // bulkInvite.error carries the message into the dialog's alert.
      return;
    }

    const succeeded = response.succeeded.length;
    const allEmailed = response.succeeded.every((invite) => invite.emailSent);
    const malformed = drafts.filter((d) => {
      const typed = d.email.trim();
      return typed && !EMAIL_RE.test(typed);
    });
    if (response.failed.length === 0 && malformed.length === 0) {
      toast.success(savedMessage(succeeded, allEmailed));
      onClose();
      return;
    }

    // Keep only the rows that failed or never sent, each with its own error,
    // so they can be fixed and sent again.
    const failed = new Map(response.failed.map((f) => [f.email, f.error]));
    setResult({ succeeded, allEmailed, failed });
    setDrafts((prev) => {
      const remaining = prev.filter(
        (d) =>
          failed.has(d.email.trim().toLowerCase()) || malformed.includes(d),
      );
      return remaining.length > 0 ? remaining : [{ email: "", role: "member" }];
    });
  }

  return (
    <form className="grid gap-4" noValidate onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor={emailId(0)}>
          {t("agentChat.settingsOrg.invite.emails")}
        </Label>
        {drafts.map((draft, i) => {
          const typed = draft.email.trim();
          const rowError =
            result?.failed.get(typed.toLowerCase()) ??
            (showInvalid && typed && !EMAIL_RE.test(typed)
              ? t("agentChat.settingsOrg.invite.invalidEmail")
              : undefined);
          const errorId = `${emailId(i)}-error`;
          return (
            <div key={i} className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  id={emailId(i)}
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft(i, { email: e.target.value })}
                  onBlur={() => setShowInvalid(true)}
                  placeholder={t(
                    "agentChat.settingsOrg.invite.emailPlaceholder",
                  )}
                  aria-label={
                    i === 0
                      ? undefined
                      : t("agentChat.settingsOrg.invite.emails")
                  }
                  aria-invalid={rowError ? true : undefined}
                  aria-describedby={rowError ? errorId : noteId}
                  className="min-w-0 flex-1"
                  autoFocus={i === drafts.length - 1}
                />
                <Select
                  value={draft.role}
                  onValueChange={(value) =>
                    setDraft(i, {
                      role: value === "admin" ? "admin" : "member",
                    })
                  }
                  disabled={!canSetAdmin}
                >
                  <SelectTrigger
                    aria-label={t("agentChat.settingsOrg.invite.role")}
                    title={ownerOnlyAdmin}
                    className="w-28"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">
                      {t("agentChat.settingsOrg.invite.member")}
                    </SelectItem>
                    <SelectItem value="admin">
                      {t("agentChat.settingsOrg.invite.admin")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {appRoles && (
                  <InviteAppRolePicker
                    appRoles={appRoles}
                    selected={draft.appRoles ?? []}
                    onChange={(next) => setDraft(i, { appRoles: next })}
                  />
                )}
                {drafts.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("agentChat.settingsOrg.invite.removeRow")}
                    onClick={() =>
                      setDrafts((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    <IconX />
                  </Button>
                )}
              </div>
              {rowError ? (
                <p id={errorId} className="text-sm text-destructive">
                  {rowError}
                </p>
              ) : null}
            </div>
          );
        })}
        <p id={noteId} className="text-sm text-muted-foreground">
          {emailConfigured === false
            ? t("agentChat.settingsOrg.invite.noteNoEmail")
            : t("agentChat.settingsOrg.invite.note")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setDrafts((prev) => [...prev, { email: "", role: "member" }])
          }
        >
          <IconPlus />
          {t("agentChat.settingsOrg.invite.addAnother")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((v) => !v)}
        >
          <IconUserPlus />
          {t("agentChat.settingsOrg.invite.pasteMany")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <IconFileImport />
          {t("agentChat.settingsOrg.invite.importCsv")}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // reset so re-uploading the same file re-fires onChange
            e.target.value = "";
          }}
        />
      </div>

      {pasteOpen && (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <Label htmlFor={`${idPrefix}-paste`}>
            {t("agentChat.settingsOrg.invite.pasteLabel")}
          </Label>
          <Textarea
            id={`${idPrefix}-paste`}
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            rows={4}
            placeholder={PASTE_PLACEHOLDER}
          />
          <div className="flex items-center gap-2">
            <Select
              value={pasteRole}
              onValueChange={(value) =>
                setPasteRole(value === "admin" ? "admin" : "member")
              }
              disabled={!canSetAdmin}
            >
              <SelectTrigger
                aria-label={t("agentChat.settingsOrg.invite.role")}
                title={ownerOnlyAdmin}
                className="w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">
                  {t("agentChat.settingsOrg.invite.addAsMembers")}
                </SelectItem>
                <SelectItem value="admin">
                  {t("agentChat.settingsOrg.invite.addAsAdmins")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              className="ms-auto"
              onClick={() => {
                setPasteValue("");
                setPasteOpen(false);
              }}
            >
              {t("agentChat.common.cancel")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                appendEmails(parseEmailList(pasteValue), pasteRole);
                setPasteValue("");
                setPasteOpen(false);
              }}
              disabled={parseEmailList(pasteValue).length === 0}
            >
              {t("agentChat.settingsOrg.invite.add")}
            </Button>
          </div>
        </div>
      )}

      {result && result.succeeded > 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {savedMessage(result.succeeded, result.allEmailed)}
        </p>
      ) : null}
      <DialogErrorAlert error={csvError ?? bulkInvite.error} />

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("agentChat.common.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={validDrafts.length === 0 || bulkInvite.isPending}
        >
          <PendingLabel
            pending={bulkInvite.isPending}
            label={t("agentChat.settingsOrg.invite.send")}
            pendingLabel={t("agentChat.settingsOrg.invite.sending")}
          />
        </Button>
      </DialogFooter>
    </form>
  );
}
