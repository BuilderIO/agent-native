import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { MobileSheet } from "@/components/MobileSheet";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import {
  authenticateWithPassword,
  signInWithMagicLink,
  signInWithGoogle,
  type NativeAuthMode,
} from "@/lib/native-auth";
import { refreshWorkspaceApps } from "@/lib/workspace-apps";

const TERMS_URL = "https://www.agent-native.com/terms";
const PRIVACY_URL = "https://www.agent-native.com/privacy";

function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </Svg>
  );
}

export function NativeSignInSheet({
  visible,
  onClose,
  onSignedIn,
}: {
  visible: boolean;
  onClose: () => void;
  onSignedIn: () => void | Promise<void>;
}) {
  const { mutedForeground } = useMobileThemeColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<NativeAuthMode>("sign-up");
  const [passwordMode, setPasswordMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [magicSubmitting, setMagicSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setError(null);
      setSubmitting(false);
      setGoogleSubmitting(false);
      setMagicSubmitting(false);
      setMode("sign-up");
      setPassword("");
      setConfirmPassword("");
      setPasswordMode(false);
    }
  }, [visible]);

  const submit = async () => {
    if (
      submitting ||
      googleSubmitting ||
      magicSubmitting ||
      !email.trim() ||
      !password ||
      (mode === "sign-up" && password !== confirmPassword)
    ) {
      if (mode === "sign-up" && password !== confirmPassword) {
        setError("Passwords do not match.");
      }
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authenticateWithPassword({ mode, email, password });
      await refreshWorkspaceApps();
      await onSignedIn();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Sign in failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openLegalPage = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  };

  const selectMode = (nextMode: NativeAuthMode) => {
    setMode(nextMode);
    setPasswordMode(false);
    setPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const submitGoogle = async () => {
    if (submitting || googleSubmitting || magicSubmitting) return;
    setGoogleSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
      await refreshWorkspaceApps();
      await onSignedIn();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Google sign-in failed. Please try again.",
      );
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const submitMagicLink = async () => {
    if (submitting || googleSubmitting || magicSubmitting) return;
    if (!email.trim()) {
      setError("Enter your email to continue.");
      return;
    }
    setMagicSubmitting(true);
    setError(null);
    try {
      await signInWithMagicLink({ email });
      await refreshWorkspaceApps();
      await onSignedIn();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Magic-link sign-in failed. Please try again.",
      );
    } finally {
      setMagicSubmitting(false);
    }
  };

  return (
    <MobileSheet
      visible={visible}
      onClose={onClose}
      motion="sheet"
      contentClassName="rounded-t-[26px] border border-border bg-card"
      overlayClassName="bg-black/55"
      accessibilityLabel="Dismiss sign in"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView edges={["bottom"]}>
          <View className="px-5 pt-3">
            <View className="self-center h-1 w-10 rounded-full bg-zinc-600" />
            <View className="flex-row items-center justify-between py-4">
              <View>
                <Text className="text-white text-[20px] font-semibold">
                  Welcome
                </Text>
                <Text className="mt-1 text-text-muted text-[14px]">
                  Create an account or sign in
                </Text>
              </View>
              <Pressable
                className="px-1 py-1 active:opacity-75"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close sign in"
              >
                <Text className="text-text-muted text-[15px] font-medium">
                  Close
                </Text>
              </Pressable>
            </View>

            <View className="mb-4 flex-row rounded-xl border border-border-dark bg-background-dark p-1">
              <Pressable
                className={`flex-1 items-center rounded-lg py-2 ${mode === "sign-up" ? "bg-gray-charcoal" : ""}`}
                onPress={() => selectMode("sign-up")}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === "sign-up" }}
              >
                <Text className="text-text-light text-[13px] font-semibold">
                  Create account
                </Text>
              </Pressable>
              <Pressable
                className={`flex-1 items-center rounded-lg py-2 ${mode === "sign-in" ? "bg-gray-charcoal" : ""}`}
                onPress={() => selectMode("sign-in")}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === "sign-in" }}
              >
                <Text className="text-text-light text-[13px] font-semibold">
                  Sign in
                </Text>
              </Pressable>
            </View>

            <Pressable
              className="mb-3 h-12 flex-row items-center justify-center gap-3 rounded-xl bg-primary active:opacity-75"
              onPress={() => void submitGoogle()}
              disabled={submitting || googleSubmitting || magicSubmitting}
              accessibilityRole="button"
              accessibilityLabel={
                mode === "sign-up"
                  ? "Sign up with Google"
                  : "Sign in with Google"
              }
            >
              {googleSubmitting ? (
                <ActivityIndicator color={mutedForeground} />
              ) : (
                <>
                  <GoogleLogo />
                  <Text className="text-primary-foreground text-[15px] font-semibold">
                    {mode === "sign-up"
                      ? "Sign up with Google"
                      : "Sign in with Google"}
                  </Text>
                </>
              )}
            </Pressable>

            <View className="mb-3 flex-row items-center gap-3">
              <View className="h-px flex-1 bg-border-dark" />
              <Text className="text-text-muted text-[12px]">or</Text>
              <View className="h-px flex-1 bg-border-dark" />
            </View>

            <TextInput
              className="mb-3 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setError(null);
              }}
              placeholder="Email"
              placeholderTextColor={mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              accessibilityLabel="Email"
              onSubmitEditing={() =>
                void (passwordMode ? submit() : submitMagicLink())
              }
              returnKeyType={passwordMode ? "next" : "done"}
            />

            {passwordMode ? (
              <>
                <TextInput
                  className="mb-2 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setError(null);
                  }}
                  placeholder="Password"
                  placeholderTextColor={mutedForeground}
                  secureTextEntry
                  textContentType={
                    mode === "sign-up" ? "newPassword" : "password"
                  }
                  autoComplete={
                    mode === "sign-up" ? "password-new" : "password"
                  }
                  accessibilityLabel="Password"
                  onSubmitEditing={() => void submit()}
                  returnKeyType="go"
                />
                {mode === "sign-up" ? (
                  <TextInput
                    className="mb-2 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      setError(null);
                    }}
                    placeholder="Confirm password"
                    placeholderTextColor={mutedForeground}
                    secureTextEntry
                    textContentType="newPassword"
                    autoComplete="password-new"
                    accessibilityLabel="Confirm password"
                    onSubmitEditing={() => void submit()}
                    returnKeyType="go"
                  />
                ) : null}
              </>
            ) : null}
            {error ? (
              <Text className="mb-2 text-error-text text-[13px]">{error}</Text>
            ) : null}

            <Pressable
              className={`mb-2 h-12 items-center justify-center rounded-xl ${
                passwordMode
                  ? email.trim() &&
                    password &&
                    (mode === "sign-in" || password === confirmPassword) &&
                    !submitting
                    ? "bg-primary active:opacity-75"
                    : "bg-zinc-800"
                  : email.trim() && !magicSubmitting
                    ? "bg-primary active:opacity-75"
                    : "bg-zinc-800"
              }`}
              onPress={() => void (passwordMode ? submit() : submitMagicLink())}
              disabled={
                !email.trim() ||
                (passwordMode && !password) ||
                submitting ||
                googleSubmitting ||
                magicSubmitting
              }
              accessibilityRole="button"
              accessibilityLabel={
                passwordMode
                  ? mode === "sign-up"
                    ? "Create account"
                    : "Sign in"
                  : "Continue"
              }
            >
              {submitting || magicSubmitting ? (
                <ActivityIndicator color={mutedForeground} />
              ) : (
                <Text
                  className={`text-[15px] font-semibold ${
                    passwordMode
                      ? email.trim() &&
                        password &&
                        (mode === "sign-in" || password === confirmPassword)
                        ? "text-primary-foreground"
                        : "text-zinc-500"
                      : email.trim()
                        ? "text-primary-foreground"
                        : "text-zinc-500"
                  }`}
                >
                  {passwordMode
                    ? mode === "sign-up"
                      ? "Create account"
                      : "Sign in"
                    : "Continue"}
                </Text>
              )}
            </Pressable>

            {mode === "sign-up" ? (
              <Text className="mb-2 text-center text-text-muted text-[11px] leading-4">
                By signing up, you accept our{" "}
                <Text
                  className="text-text-light underline"
                  onPress={() => openLegalPage(TERMS_URL)}
                >
                  Terms
                </Text>{" "}
                and{" "}
                <Text
                  className="text-text-light underline"
                  onPress={() => openLegalPage(PRIVACY_URL)}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            ) : null}

            <Pressable
              className="mb-3 h-9 items-center justify-center active:opacity-75"
              onPress={() => {
                setPasswordMode((current) => !current);
                setPassword("");
                setConfirmPassword("");
                setError(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                passwordMode
                  ? "Use a sign-in link instead"
                  : "Use a password instead"
              }
            >
              <Text className="text-text-muted text-[13px] font-medium underline">
                {passwordMode
                  ? "Use a sign-in link instead"
                  : "Use a password instead"}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </MobileSheet>
  );
}
