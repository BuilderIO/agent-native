import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
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
  IconLoader2,
  IconCheck,
  IconX,
  IconFileImport,
  IconPlus,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

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
import { Button, ErrorText } from "./TeamPrimitives.js";

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
        <Button
          type="button"
          className="h-auto max-w-40 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          {selected.length
            ? selected.map(labelFor).join(", ")
            : t("org.appRolesOptional")}
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
  appRoles,
  onClose,
}: {
  currentUserRole: string | null;
  appRoles?: AppRolesDescriptor;
  onClose: () => void;
}) {
  const t = useT();
  const bulkInvite = useBulkInviteMembers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftInvite[]>([
    { email: "", role: "member" },
  ]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteRole, setPasteRole] = useState<InviteRole>("member");
  const [resultBanner, setResultBanner] = useState<{
    succeeded: number;
    failed: { email: string; error: string }[];
  } | null>(null);

  const canSetAdmin = currentUserRole === "owner";
  const ownerOnlyAdmin = canSetAdmin
    ? undefined
    : t("agentChat.settingsOrg.invite.ownerOnlyAdmin");

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
    void file.text().then((text) => {
      const emails = parseCsvEmails(text);
      if (emails.length) {
        appendEmails(emails, "member");
      } else {
        setResultBanner({
          succeeded: 0,
          failed: [
            {
              email: file.name,
              error: t("agentChat.settingsOrg.invite.csvNoEmails"),
            },
          ],
        });
      }
    });
  }

  async function submit() {
    setResultBanner(null);
    const dedup = new Map<string, DraftInvite>();
    for (const d of validDrafts) {
      // Mirrors createInvitationHandler, which refuses an admin invite from
      // anyone but the owner.
      const role = canSetAdmin ? d.role : "member";
      dedup.set(d.email, { ...d, role });
    }
    const invites = Array.from(dedup.values()).map((invite) => ({
      ...invite,
      appId: appRoles?.appId,
      appRoles: invite.appRoles?.length ? invite.appRoles : undefined,
    }));
    if (invites.length === 0) return;

    const result = await bulkInvite.mutateAsync(invites);
    setResultBanner({
      succeeded: result.succeeded.length,
      failed: result.failed,
    });

    // Wipe drafts that succeeded; leave failed ones so the user can fix
    // and retry. If everything succeeded, reset to a single blank row.
    const failedEmails = new Set(result.failed.map((f) => f.email));
    setDrafts((prev) => {
      const remaining = prev.filter((d) =>
        failedEmails.has(d.email.trim().toLowerCase()),
      );
      return remaining.length > 0 ? remaining : [{ email: "", role: "member" }];
    });

    // Auto-close on full success.
    if (result.failed.length === 0 && result.succeeded.length > 0) {
      setTimeout(() => onClose(), 1200);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="invite-email-0">
          {t("agentChat.settingsOrg.invite.emails")}
        </Label>
        {drafts.map((draft, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              id={`invite-email-${i}`}
              type="email"
              value={draft.email}
              onChange={(e) => setDraft(i, { email: e.target.value })}
              placeholder={t("agentChat.settingsOrg.invite.emailPlaceholder")}
              className="h-8 flex-1"
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
                className="h-auto w-auto rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
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
                aria-label={t("agentChat.settingsOrg.invite.removeRow")}
                onClick={() =>
                  setDrafts((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-muted-foreground hover:text-destructive"
              >
                <IconX size={14} />
              </Button>
            )}
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          {t("agentChat.settingsOrg.invite.note")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={() =>
            setDrafts((prev) => [...prev, { email: "", role: "member" }])
          }
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconPlus size={14} />
          {t("agentChat.settingsOrg.invite.addAnother")}
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconUserPlus size={14} />
          {t("agentChat.settingsOrg.invite.pasteMany")}
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconFileImport size={14} />
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
        <div className="space-y-2 rounded-md border border-border p-3">
          <Label
            htmlFor="invite-paste"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("agentChat.settingsOrg.invite.pasteLabel")}
          </Label>
          <Textarea
            id="invite-paste"
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
                className="h-auto w-auto rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
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
              intent="primary"
              emphasis="solid"
              onClick={() => {
                appendEmails(parseEmailList(pasteValue), pasteRole);
                setPasteValue("");
                setPasteOpen(false);
              }}
              disabled={parseEmailList(pasteValue).length === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("agentChat.settingsOrg.invite.add")}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => {
                setPasteValue("");
                setPasteOpen(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {t("agentChat.common.cancel")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          intent="primary"
          emphasis="solid"
          disabled={validDrafts.length === 0 || bulkInvite.isPending}
          onClick={submit}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {bulkInvite.isPending ? (
            <IconLoader2 size={14} className="animate-spin" />
          ) : (
            <span className="inline-flex items-center gap-1">
              <IconCheck size={14} />
              {t("agentChat.settingsOrg.invite.send")}
            </span>
          )}
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("agentChat.settingsOrg.invite.close")}
        </Button>
      </div>

      {resultBanner && (
        <div className="space-y-1 rounded-md border border-border bg-accent/30 p-2.5">
          {resultBanner.succeeded > 0 && (
            <p className="text-[11px] text-primary">
              <IconCheck className="inline h-3 w-3 -mt-0.5 me-1" />
              {t("agentChat.settingsOrg.invite.sent", {
                count: resultBanner.succeeded,
              })}
            </p>
          )}
          {resultBanner.failed.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-destructive">
              {resultBanner.failed.map((f) => (
                <li key={f.email}>
                  <IconAlertTriangle className="inline h-3 w-3 -mt-0.5 me-1" />
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ErrorText error={bulkInvite.error} />
    </div>
  );
}
