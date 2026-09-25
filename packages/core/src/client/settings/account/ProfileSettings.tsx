import {
  ActionButton,
  Avatar,
  TextField,
} from "@agent-native/toolkit/design-system";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { UserProfile } from "../../../user-profile/shared.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useT } from "../../i18n.js";
import { useActionMutation, useActionQuery } from "../../use-action.js";
import { useSession } from "../../use-session.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
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

  return (
    <SettingsGroup id="details" title={t("agentChat.common.details")}>
      <ProfilePhotoRow email={email} name={profileName || email || ""} />
      <ProfileNameRow
        email={email}
        profileName={profileName}
        loading={!!email && profileQuery.isLoading}
      />
      {email ? <EmailRow email={email} /> : null}
    </SettingsGroup>
  );
}

function ProfilePhotoRow({
  email,
  name,
}: {
  email: string | undefined;
  name: string;
}) {
  const t = useT();
  const { avatarUrl, uploading, status, upload } = useAvatarUpload(email);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  };

  return (
    <SettingsRow
      id="profile-photo"
      label={t(key("profilePhoto"))}
      description={
        status === "saved" ? (
          <span className="text-primary" role="status">
            {t(key("photoUpdated"))}
          </span>
        ) : status === "error" ? (
          <span className="text-destructive" role="alert">
            {t(key("photoError"))}
          </span>
        ) : undefined
      }
      control={
        <div className="flex items-center gap-3">
          <Avatar
            name={name}
            src={avatarUrl}
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
          <ActionButton
            type="button"
            intent="neutral"
            emphasis="outline"
            size="compact"
            pending={uploading}
            disabled={!email || uploading}
            onPress={() => fileInputRef.current?.click()}
          >
            {uploading ? t(key("uploading")) : t(key("change"))}
          </ActionButton>
        </div>
      }
    />
  );
}

function ProfileNameRow({
  email,
  profileName,
  loading,
}: {
  email: string | undefined;
  profileName: string;
  loading: boolean;
}) {
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

  return (
    <SettingsRow
      id="profile-name"
      label={t(key("name"))}
      description={
        updateProfile.error ? (
          <span className="text-destructive" role="alert">
            {t(key("nameSaveError"))}
          </span>
        ) : updateProfile.isSuccess ? (
          <span className="text-primary" role="status">
            {t(key("nameSaved"))}
          </span>
        ) : (
          t(key("nameDescription"))
        )
      }
      control={
        <TextField
          id="agent-native-profile-name"
          value={draft}
          onChange={(value) => {
            editedRef.current = true;
            updateProfile.reset();
            setDraft(value);
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
          autoComplete="name"
          className="w-full sm:w-64"
        />
      }
    />
  );
}

function EmailRow({ email }: { email: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const { pending, status, setStatus, submit } = useEmailChange();

  const trimmed = newEmail.trim();
  const canSend =
    !pending && !!trimmed && trimmed.toLowerCase() !== email.toLowerCase();

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

  return (
    <SettingsRow
      id="email"
      label={t(key("email"))}
      description={
        status === "sent" && !open ? (
          <span className="text-primary" role="status">
            {t(key("emailChangeSent"))}
          </span>
        ) : (
          email
        )
      }
      control={
        <Dialog open={open} onOpenChange={openDialog}>
          <ActionButton
            type="button"
            intent="neutral"
            emphasis="outline"
            size="compact"
            onPress={() => openDialog(true)}
          >
            {t(key("change"))}
          </ActionButton>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t(key("changeEmail"))}</DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <TextField
                id="agent-native-new-email"
                type="email"
                label={t(key("newEmail"))}
                value={newEmail}
                onChange={(value) => {
                  setStatus("idle");
                  setNewEmail(value);
                }}
                placeholder={t(key("newEmailPlaceholder"))}
                autoComplete="email"
                autoFocus
                disabled={pending}
                invalid={status === "error"}
                errorMessage={
                  status === "error" ? t(key("emailChangeError")) : undefined
                }
              />
              <DialogFooter className="gap-2">
                <ActionButton
                  type="button"
                  intent="neutral"
                  emphasis="outline"
                  size="compact"
                  onPress={() => openDialog(false)}
                >
                  {t("agentChat.common.cancel")}
                </ActionButton>
                <ActionButton
                  type="submit"
                  intent="primary"
                  emphasis="solid"
                  size="compact"
                  pending={pending}
                  disabled={!canSend}
                >
                  {pending ? t(key("sending")) : t(key("sendConfirmation"))}
                </ActionButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    />
  );
}
