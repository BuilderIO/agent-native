import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import type { UserProfile } from "@agent-native/core/user-profile/shared";
import { Avatar } from "@agent-native/toolkit/design-system";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
} from "../../../design-system/parts.js";
import { profileInitials } from "./account-copy.js";
import { useAvatarUpload, useEmailChange } from "./account-hooks.js";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

/** Account › Profile: photo, name, and email. */
export function ProfileSettings() {
  const t = useT();
  const { session } = useSession();
  const email = session?.email;
  const profileQuery = useActionQuery<UserProfile>(
    "get-user-profile",
    undefined,
    { enabled: !!email },
  );
  const profileName = profileQuery.data?.name || session?.name || "";

  const photo = useProfilePhotoRow(email, profileName || email || "");
  const name = useProfileNameRow({
    email,
    profileName,
    loading: !!email && profileQuery.isLoading,
  });
  const emailRow = useProfileEmailRow();
  const { actions, slots } = combineFragments([photo, name, emailRow]);
  return (
    <ModelSurface
      model={{
        id: "settings",
        rows: [
          {
            id: "settings.profile.details",
            part: "settings.group",
            label: t("agentChat.common.details"),
            anchor: "details",
            rows: [...photo.rows, ...name.rows, ...emailRow.rows],
          },
        ],
      }}
      actions={actions}
      slots={slots}
    />
  );
}

function useProfilePhotoRow(
  email: string | undefined,
  name: string,
): ModelFragment {
  const t = useT();
  const { avatarUrl, uploading, status, upload, remove } =
    useAvatarUpload(email);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  };

  const statusText =
    status === "saved"
      ? t(key("photoUpdated"))
      : status === "removed"
        ? t(key("photoRemoved"))
        : status === "error"
          ? t(key("photoError"))
          : undefined;
  return {
    rows: [
      {
        id: "settings.profile.details.photo",
        part: "settings.row",
        label: t(key("profilePhoto")),
        description: statusText,
        anchor: "profile-photo",
        ...(statusText
          ? { regions: { description: "profile-photo-status" } }
          : {}),
        slot: "profile-photo-control",
      },
    ],
    slots: {
      "profile-photo-status":
        status === "error" ? (
          <span className="text-destructive" role="alert">
            {statusText}
          </span>
        ) : (
          <span className="text-primary" role="status">
            {statusText}
          </span>
        ),
      "profile-photo-control": (
        <div className="flex items-center gap-3">
          <Avatar
            name={name}
            src={status === "removed" ? null : avatarUrl}
            fallback={profileInitials(name)}
            size="default"
            className="size-8 shrink-0 rounded-full border border-border bg-accent text-xs font-semibold text-muted-foreground"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!email || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Spinner aria-hidden="true" /> : null}
            {uploading ? t(key("uploading")) : t(key("change"))}
          </Button>
          {avatarUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!email || uploading}
              onClick={() => void remove()}
            >
              {t(key("removePhoto"))}
            </Button>
          ) : null}
        </div>
      ),
    },
  };
}

function useProfileNameRow({
  email,
  profileName,
  loading,
}: {
  email: string | undefined;
  profileName: string;
  loading: boolean;
}): ModelFragment {
  const t = useT();
  const updateProfile = useActionMutation<UserProfile, { name: string }>(
    "update-user-profile",
  );
  const [draft, setDraft] = useState(profileName);
  const [saved, setSaved] = useState(profileName);
  const editedRef = useRef(false);

  useEffect(() => {
    if (editedRef.current) return;
    setDraft(profileName);
    setSaved(profileName);
  }, [profileName]);

  const commit = () => {
    const next = draft.trim();
    if (!email || updateProfile.isPending) return;
    if (!next) {
      editedRef.current = false;
      setDraft(saved);
      return;
    }
    if (next === saved.trim()) {
      editedRef.current = false;
      return;
    }
    const previous = saved;
    setSaved(next);
    updateProfile.mutate(
      { name: next },
      {
        onSuccess: (profile) => {
          editedRef.current = false;
          setDraft(profile.name);
          setSaved(profile.name);
        },
        onError: () => {
          setSaved(previous);
        },
      },
    );
  };

  const revert = () => {
    editedRef.current = false;
    updateProfile.reset();
    setDraft(saved);
  };

  const statusText = updateProfile.error
    ? t(key("nameSaveError"))
    : updateProfile.isSuccess
      ? t(key("nameSaved"))
      : null;
  return {
    rows: [
      {
        id: "settings.profile.details.name",
        part: "settings.row",
        kind: "field",
        label: t(key("name")),
        description: statusText ?? t(key("nameDescription")),
        anchor: "profile-name",
        ...(statusText
          ? { regions: { description: "profile-name-status" } }
          : {}),
        slot: "profile-name-control",
      },
    ],
    slots: {
      "profile-name-status": updateProfile.error ? (
        <span className="text-destructive" role="alert">
          {statusText}
        </span>
      ) : (
        <span className="text-primary" role="status">
          {statusText}
        </span>
      ),
      "profile-name-control": (
        <Input
          id="agent-native-profile-name"
          size="sm"
          value={draft}
          onChange={(event) => {
            editedRef.current = true;
            updateProfile.reset();
            setDraft(event.currentTarget.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              revert();
            }
          }}
          placeholder={t(key("namePlaceholder"))}
          disabled={!email || loading}
          aria-label={t(key("name"))}
          aria-invalid={updateProfile.error ? true : undefined}
          autoComplete="name"
          className="w-full sm:w-64"
        />
      ),
    },
  };
}

/** The email row on its own, where no group draws it. */
export function ProfileEmailSettings() {
  const fragment = useProfileEmailRow();
  return (
    <ModelSurface
      model={{ id: "settings", rows: fragment.rows }}
      actions={fragment.actions}
      slots={fragment.slots}
    />
  );
}

function useProfileEmailRow(): ModelFragment {
  const t = useT();
  const { session, status: sessionStatus } = useSession();
  const email =
    sessionStatus === "authenticated" && session?.email ? session.email : null;
  // A deployment without an email provider can never deliver the confirmation,
  // so the row says that up front instead of failing after a submit.
  const org = useOrg({ enabled: email !== null });
  const emailDeliveryAvailable = org.data?.emailConfigured !== false;
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const { pending, status, setStatus, submit } = useEmailChange();
  const [rowEmail, setRowEmail] = useState(email);
  if (rowEmail !== email) {
    setRowEmail(email);
    setOpen(false);
    setNewEmail("");
    setStatus("idle");
  }

  if (email === null) return { rows: [] };

  const trimmed = newEmail.trim();
  const canSend =
    !pending &&
    emailDeliveryAvailable &&
    !!trimmed &&
    trimmed.toLowerCase() !== email.toLowerCase();

  const openDialog = (next: boolean) => {
    setOpen(next);
    if (next) {
      setNewEmail("");
      setStatus("idle");
    }
  };

  const send = async () => {
    if (!canSend) return;
    if (await submit(trimmed)) setOpen(false);
  };

  const sent = status === "sent" && !open;
  return {
    rows: [
      {
        id: "settings.profile.details.email",
        part: "settings.row",
        label: t(key("email")),
        description: sent
          ? t(key("emailChangeSent"))
          : emailDeliveryAvailable
            ? email
            : t(key("emailDeliveryUnavailable")),
        anchor: "email",
        ...(sent || !emailDeliveryAvailable
          ? { regions: { description: "profile-email-status" } }
          : {}),
        slot: "profile-email-control",
      },
    ],
    slots: {
      "profile-email-status": sent ? (
        <span className="text-primary" role="status">
          {t(key("emailChangeSent"))}
        </span>
      ) : (
        <span className="text-muted-foreground" role="status">
          {t(key("emailDeliveryUnavailable"))}
        </span>
      ),
      "profile-email-control": (
        <Dialog open={open} onOpenChange={openDialog}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!emailDeliveryAvailable}
            onClick={() => openDialog(true)}
          >
            {t(key("change"))}
          </Button>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t(key("changeEmail"))}</DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void send();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="agent-native-new-email">
                  {t(key("newEmail"))}
                </Label>
                <Input
                  id="agent-native-new-email"
                  type="email"
                  value={newEmail}
                  onChange={(event) => {
                    setStatus("idle");
                    setNewEmail(event.currentTarget.value);
                  }}
                  autoComplete="email"
                  autoFocus
                  required
                  readOnly={pending}
                />
              </div>
              {status === "error" ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t(key("emailChangeError"))}
                  </AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter className="gap-2 sm:space-x-0">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openDialog(false)}
                >
                  {t("agentChat.common.cancel")}
                </Button>
                <Button type="submit" disabled={!canSend}>
                  {pending ? <Spinner aria-hidden="true" /> : null}
                  {pending ? t(key("sending")) : t(key("sendConfirmation"))}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ),
    },
  };
}
