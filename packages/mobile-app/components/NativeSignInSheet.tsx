import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  ModalSafeAreaProvider,
  SafeAreaView,
} from "@/components/uniwind-interop";
import {
  authenticateWithPassword,
  type NativeAuthMode,
} from "@/lib/native-auth";
import { refreshWorkspaceApps } from "@/lib/workspace-apps";

export function NativeSignInSheet({
  visible,
  onClose,
  onSignedIn,
}: {
  visible: boolean;
  onClose: () => void;
  onSignedIn: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<NativeAuthMode>("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setError(null);
      setSubmitting(false);
      setPassword("");
      setConfirmPassword("");
    }
  }, [visible]);

  const submit = async () => {
    if (
      submitting ||
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <ModalSafeAreaProvider style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 justify-end bg-black/55"
        >
          <Pressable
            className="flex-1"
            onPress={onClose}
            accessibilityLabel="Dismiss sign in"
          />
          <SafeAreaView
            edges={["bottom"]}
            className="rounded-t-[26px] border border-border-dark bg-card-dark"
          >
            <View className="px-5 pt-3">
              <View className="self-center h-1 w-10 rounded-full bg-zinc-600" />
              <View className="flex-row items-center justify-between py-4">
                <Text className="text-white text-[20px] font-semibold">
                  {mode === "sign-up" ? "Create account" : "Sign in"}
                </Text>
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
                  className={`flex-1 items-center rounded-lg py-2 ${mode === "sign-in" ? "bg-gray-charcoal" : ""}`}
                  onPress={() => {
                    setMode("sign-in");
                    setError(null);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === "sign-in" }}
                >
                  <Text className="text-text-light text-[13px] font-semibold">
                    Sign in
                  </Text>
                </Pressable>
                <Pressable
                  className={`flex-1 items-center rounded-lg py-2 ${mode === "sign-up" ? "bg-gray-charcoal" : ""}`}
                  onPress={() => {
                    setMode("sign-up");
                    setError(null);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === "sign-up" }}
                >
                  <Text className="text-text-light text-[13px] font-semibold">
                    Create account
                  </Text>
                </Pressable>
              </View>

              <TextInput
                className="mb-3 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setError(null);
                }}
                placeholder="Email"
                placeholderTextColor="#71717a"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                accessibilityLabel="Email"
              />
              <TextInput
                className="mb-2 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setError(null);
                }}
                placeholder="Password"
                placeholderTextColor="#71717a"
                secureTextEntry
                textContentType="password"
                autoComplete="password"
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
                  placeholderTextColor="#71717a"
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="password-new"
                  accessibilityLabel="Confirm password"
                  onSubmitEditing={() => void submit()}
                  returnKeyType="go"
                />
              ) : null}
              {error ? (
                <Text className="mb-2 text-error-text text-[13px]">
                  {error}
                </Text>
              ) : null}
              <Pressable
                className={`mb-3 h-12 items-center justify-center rounded-xl ${
                  email.trim() &&
                  password &&
                  (mode === "sign-in" || password === confirmPassword) &&
                  !submitting
                    ? "bg-white active:opacity-75"
                    : "bg-zinc-800"
                }`}
                onPress={() => void submit()}
                disabled={!email.trim() || !password || submitting}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                {submitting ? (
                  <ActivityIndicator color="#71717a" />
                ) : (
                  <Text
                    className={`text-[15px] font-semibold ${
                      email.trim() &&
                      password &&
                      (mode === "sign-in" || password === confirmPassword)
                        ? "text-background-dark"
                        : "text-zinc-500"
                    }`}
                  >
                    {mode === "sign-up" ? "Create account" : "Sign in"}
                  </Text>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </ModalSafeAreaProvider>
    </Modal>
  );
}
