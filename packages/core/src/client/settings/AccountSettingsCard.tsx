import {
  ActionButton,
  Avatar,
  Surface,
  TextField,
} from "@agent-native/toolkit/design-system";
import { IconCamera, IconCheck, IconLock } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { UserProfile } from "../../user-profile/shared.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { uploadAvatar, useAvatarUrl } from "../use-avatar.js";
import { useSession } from "../use-session.js";
import { cn } from "../utils.js";
import { SchedulingTimezoneField } from "./SchedulingTimezoneField.js";

function profileInitials(name: string): string {
  return (
    name
      .split(/[ @._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

interface AuthMethods {
  hasPassword: boolean;
}

interface PasswordMutationResult {
  status: boolean;
}

function PasswordSettings() {
  const t = useT();
  const { session } = useSession();
  const authMethods = useActionQuery<AuthMethods>(
    "get-auth-methods",
    undefined,
    { enabled: !!session?.email },
  );
  const setPassword = useActionMutation<
    PasswordMutationResult,
    { newPassword: string }
  >("set-password");
  const changePassword = useActionMutation<
    PasswordMutationResult,
    { currentPassword: string; newPassword: string }
  >("change-password");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<
    "length" | "mismatch" | null
  >(null);
  const [saved, setSaved] = useState(false);

  const mutation = authMethods.data?.hasPassword ? changePassword : setPassword;
  const error = validationError
    ? validationError === "length"
      ? t("settings.passwordMinLength")
      : t("settings.passwordMismatch")
    : mutation.error
      ? t("settings.passwordSaveError")
      : undefined;

  const clearStatus = () => {
    setSaved(false);
    setValidationError(null);
    setPassword.reset();
    changePassword.reset();
  };

  const submit = () => {
    setSaved(false);
    setValidationError(null);
    if (newPassword.length < 8) {
      setValidationError("length");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("mismatch");
      return;
    }

    const onSuccess = () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      void authMethods.refetch();
    };

    if (authMethods.data?.hasPassword) {
      changePassword.mutate({ currentPassword, newPassword }, { onSuccess });
    } else {
      setPassword.mutate({ newPassword }, { onSuccess });
    }
  };

  const isPending = setPassword.isPending || changePassword.isPending;
  const isLoading = authMethods.isLoading;
  const hasPassword = authMethods.data?.hasPassword ?? false;

  if (!session?.email) return null;

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <div className="flex items-start gap-2">
        <IconLock className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium">
            {hasPassword
              ? t("settings.passwordChange")
              : t("settings.passwordTitle")}
          </h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.passwordDescription")}
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.passwordStatusLoading")}
        </p>
      ) : authMethods.error ? (
        <p className="text-xs text-destructive">
          {t("settings.passwordSaveError")}
        </p>
      ) : (
        <>
          {hasPassword && (
            <TextField
              id="agent-native-current-password"
              type="password"
              label={t("settings.passwordCurrentLabel")}
              value={currentPassword}
              onChange={(value) => {
                clearStatus();
                setCurrentPassword(value);
              }}
              placeholder={t("settings.passwordPlaceholder")}
              autoComplete="current-password"
              disabled={isPending}
            />
          )}
          <TextField
            id="agent-native-new-password"
            type="password"
            label={t("settings.passwordNewLabel")}
            value={newPassword}
            onChange={(value) => {
              clearStatus();
              setNewPassword(value);
            }}
            placeholder={t("settings.passwordPlaceholder")}
            autoComplete={hasPassword ? "new-password" : "new-password"}
            disabled={isPending}
            invalid={!!error}
          />
          <TextField
            id="agent-native-confirm-password"
            type="password"
            label={t("settings.passwordConfirmLabel")}
            value={confirmPassword}
            onChange={(value) => {
              clearStatus();
              setConfirmPassword(value);
            }}
            placeholder={t("settings.passwordPlaceholder")}
            autoComplete="new-password"
            disabled={isPending}
            invalid={!!error}
            errorMessage={error}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="min-h-4 text-xs">
              {saved && (
                <p className="flex items-center gap-1 text-primary">
                  <IconCheck className="size-3" />
                  {t("settings.passwordSaved")}
                </p>
              )}
            </div>
            <ActionButton
              type="button"
              intent="primary"
              emphasis="solid"
              size="compact"
              pending={isPending}
              disabled={
                isPending ||
                !newPassword ||
                !confirmPassword ||
                (hasPassword && !currentPassword)
              }
              onPress={submit}
            >
              {isPending
                ? t("settings.passwordSaving")
                : hasPassword
                  ? t("settings.passwordChange")
                  : t("settings.passwordAdd")}
            </ActionButton>
          </div>
        </>
      )}
    </div>
  );
}

export interface AccountSettingsFormProps {
  compact?: boolean;
}

export function AccountSettingsForm({
  compact = false,
}: AccountSettingsFormProps) {
  const t = useT();
  const { session, isLoading } = useSession();
  const email = session?.email;
  const profileQuery = useActionQuery<UserProfile>(
    "get-user-profile",
    undefined,
    { enabled: !!email },
  );
  const updateProfile = useActionMutation<UserProfile, { name: string }>(
    "update-user-profile",
  );
  const avatarUrl = useAvatarUrl(email);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [name, setName] = useState("");

  const displayName =
    profileQuery.data?.name ||
    session?.name ||
    email ||
    t("settings.profileSignedOut");

  useEffect(() => {
    const nextName = profileQuery.data?.name || session?.name;
    if (nextName) setName(nextName);
  }, [profileQuery.data?.name, session?.name]);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !email) return;
    setUploading(true);
    setPhotoStatus("idle");
    try {
      await uploadAvatar(file, email);
      setPhotoStatus("saved");
    } catch {
      setPhotoStatus("error");
    } finally {
      setUploading(false);
    }
  };

  const handleProfileSave = () => {
    const nextName = name.trim();
    if (!nextName || !email) return;
    updateProfile.mutate({ name: nextName });
  };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className="flex items-center gap-3">
        <Avatar
          name={displayName}
          src={avatarUrl}
          fallback={profileInitials(displayName)}
          size={compact ? "default" : "large"}
          className={cn(
            "shrink-0 rounded-full border border-border bg-accent font-semibold text-muted-foreground",
            compact ? "size-12 text-[13px]" : "size-14 text-[15px]",
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate font-medium",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {isLoading ? t("settings.profileLoading") : displayName}
          </p>
          {email && (
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          )}
          {photoStatus === "saved" && (
            <p className="mt-1 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <IconCheck className="size-3" />
              {t("settings.profilePhotoUpdated")}
            </p>
          )}
          {photoStatus === "error" && (
            <p className="mt-1 text-xs text-destructive">
              {t("settings.profilePhotoError")}
            </p>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
        <ActionButton
          type="button"
          intent="neutral"
          emphasis="outline"
          size="compact"
          disabled={!email || uploading}
          leadingIcon={<IconCamera className="size-3.5" />}
          onPress={() => fileInputRef.current?.click()}
          className="shrink-0"
        >
          {uploading
            ? t("settings.profileUploading")
            : t("settings.profileChangePhoto")}
        </ActionButton>
      </div>

      <div className="space-y-3">
        <TextField
          id="agent-native-profile-name"
          label={t("settings.profileNameLabel")}
          value={name}
          onChange={(value) => {
            updateProfile.reset();
            setName(value);
          }}
          placeholder={t("settings.profileNamePlaceholder")}
          description={t("settings.profileNameDescription")}
          disabled={!email || profileQuery.isLoading || updateProfile.isPending}
        />
      </div>

      <div className="border-t border-border/60 pt-3">
        <SchedulingTimezoneField />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <div className="min-h-4 text-xs">
          {updateProfile.isSuccess && (
            <p className="text-primary">{t("settings.profileSaved")}</p>
          )}
          {updateProfile.error && (
            <p className="text-destructive">{t("settings.profileSaveError")}</p>
          )}
        </div>
        <ActionButton
          type="button"
          intent="primary"
          emphasis="solid"
          size="compact"
          pending={updateProfile.isPending}
          disabled={
            !email ||
            profileQuery.isLoading ||
            updateProfile.isPending ||
            !name.trim()
          }
          onPress={handleProfileSave}
        >
          {updateProfile.isPending
            ? t("settings.profileSaving")
            : t("settings.profileSave")}
        </ActionButton>
      </div>
    </div>
  );
}

export interface AccountSettingsCardProps {
  className?: string;
}

export function AccountSettingsCard({ className }: AccountSettingsCardProps) {
  const t = useT();

  return (
    <Surface
      as="section"
      id="account"
      elevation="low"
      padding="none"
      className={cn(
        "w-full scroll-mt-4 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          {t("settings.profileTitle")}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("settings.profileDescription")}
        </p>
      </div>
      <div className="mt-5">
        <AccountSettingsForm />
        <PasswordSettings />
      </div>
    </Surface>
  );
}
