import {
  ActionButton,
  Avatar,
  IconButton,
  TextField,
} from "@agent-native/toolkit/design-system";
import {
  IconCamera,
  IconCheck,
  IconLock,
  IconPencil,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { PASSWORD_MIN_LENGTH } from "../../shared/password-policy.js";
import type { UserProfile } from "../../user-profile/shared.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { uploadAvatar, useAvatarUrl } from "../use-avatar.js";
import { useSession } from "../use-session.js";
import { cn } from "../utils.js";
import { SchedulingTimezoneField } from "./SchedulingTimezoneField.js";
import { SettingsGroup, SettingsRow } from "./SettingsRow.js";
import { SettingsSkeleton } from "./SettingsSkeleton.js";

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
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
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

  const passwordForm = isLoading ? (
    <SettingsSkeleton lines={2} />
  ) : authMethods.error ? (
    <p className="text-xs text-destructive">
      {t("settings.passwordSaveError")}
    </p>
  ) : (
    <div className="space-y-3">
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
        autoComplete="new-password"
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
    </div>
  );

  return (
    <SettingsRow
      id="password"
      label={
        <span className="flex items-center gap-2">
          <IconLock className="size-4 text-muted-foreground" />
          {hasPassword
            ? t("settings.passwordChange")
            : t("settings.passwordTitle")}
        </span>
      }
      description={t("settings.passwordDescription")}
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
            >
              Manage
            </ActionButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[min(420px,calc(100vw-2rem))] p-4"
          >
            {passwordForm}
          </PopoverContent>
        </Popover>
      }
    />
  );
}

export interface AccountSettingsFormProps {
  compact?: boolean;
}

export function AccountSettingsForm({
  compact = false,
}: AccountSettingsFormProps) {
  const t = useT();
  const { session } = useSession();
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
  const [savedName, setSavedName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const nameEditedRef = useRef(false);

  const profileName = profileQuery.data?.name || session?.name || "";
  const displayName =
    name || profileName || email || t("settings.profileSignedOut");

  useEffect(() => {
    nameEditedRef.current = false;
    setIsEditingName(false);
    setName("");
    setSavedName("");
  }, [email]);

  useEffect(() => {
    if (nameEditedRef.current) return;
    setName(profileName);
    setSavedName(profileName);
  }, [email, profileName]);

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
    if (!nextName || !email || nextName === savedName.trim()) return;
    updateProfile.mutate(
      { name: nextName },
      {
        onSuccess: (profile) => {
          setName(profile.name);
          setSavedName(profile.name);
          nameEditedRef.current = false;
          setIsEditingName(false);
        },
      },
    );
  };

  const handleProfileEdit = () => {
    updateProfile.reset();
    nameEditedRef.current = true;
    setName(savedName);
    setIsEditingName(true);
  };

  const canSaveName =
    !!email &&
    !updateProfile.isPending &&
    !!name.trim() &&
    name.trim() !== savedName.trim();

  const profileStatus =
    photoStatus === "saved" ? (
      <span className="text-primary">{t("settings.profilePhotoUpdated")}</span>
    ) : photoStatus === "error" ? (
      <span className="text-destructive">
        {t("settings.profilePhotoError")}
      </span>
    ) : email ? (
      email
    ) : undefined;

  return (
    <SettingsGroup
      id="account"
      title={t("settings.profileTitle")}
      description={t("settings.profileDescription")}
      className={cn(compact && "[&>div:last-child>div>div]:py-3")}
    >
      <SettingsRow
        id="profile"
        label={t("settings.profileTitle")}
        description={profileStatus}
        control={
          <div className="flex items-center gap-3">
            <Avatar
              name={displayName}
              src={avatarUrl}
              fallback={profileInitials(displayName)}
              size="default"
              className="size-10 shrink-0 rounded-full border border-border bg-accent font-semibold text-muted-foreground"
            />
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
            >
              {uploading
                ? t("settings.profileUploading")
                : t("settings.profileChangePhoto")}
            </ActionButton>
          </div>
        }
      />
      <SettingsRow
        id="profile-name"
        label={t("settings.profileNameLabel")}
        description={
          updateProfile.isSuccess ? (
            <span className="text-primary">{t("settings.profileSaved")}</span>
          ) : updateProfile.error ? (
            <span className="text-destructive">
              {t("settings.profileSaveError")}
            </span>
          ) : (
            t("settings.profileNameDescription")
          )
        }
        control={
          isEditingName ? (
            <div className="flex w-full items-center gap-2 sm:w-80">
              <TextField
                id="agent-native-profile-name"
                value={name}
                onChange={(value) => {
                  nameEditedRef.current = true;
                  updateProfile.reset();
                  setName(value);
                }}
                placeholder={t("settings.profileNamePlaceholder")}
                disabled={!email || updateProfile.isPending}
                autoFocus
                aria-label={t("settings.profileNameLabel")}
                className="min-w-0 flex-1"
              />
              <ActionButton
                type="button"
                intent="primary"
                emphasis="solid"
                size="compact"
                pending={updateProfile.isPending}
                disabled={!canSaveName}
                onPress={handleProfileSave}
              >
                {updateProfile.isPending
                  ? t("settings.profileSaving")
                  : t("settings.profileSave")}
              </ActionButton>
            </div>
          ) : (
            <div className="flex w-full items-center justify-end gap-2 sm:w-80">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {displayName}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    type="button"
                    intent="neutral"
                    emphasis="ghost"
                    size="compact"
                    icon={<IconPencil size={14} />}
                    label={t("settings.profileNameEdit")}
                    title={t("settings.profileNameEdit")}
                    disabled={!email}
                    onPress={handleProfileEdit}
                  />
                </TooltipTrigger>
                <TooltipContent>{t("settings.profileNameEdit")}</TooltipContent>
              </Tooltip>
            </div>
          )
        }
      />
      <SettingsRow
        id="timezone"
        label={t("settings.timezoneLabel", { defaultValue: "Timezone" })}
        description={t("settings.timezoneHint", {
          defaultValue: "Used for timestamps and scheduled automations.",
        })}
        control={<SchedulingTimezoneField compact />}
      />
      <PasswordSettings />
    </SettingsGroup>
  );
}

export interface AccountSettingsCardProps {
  className?: string;
}

export function AccountSettingsCard({ className }: AccountSettingsCardProps) {
  return (
    <div className={cn("w-full", className)}>
      <AccountSettingsForm />
    </div>
  );
}
