import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconDeviceDesktop,
  IconFolder,
  IconGitBranch,
  IconX,
} from "@tabler/icons-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

export type MobileExecutionTarget = "local" | "worktree";

const REMOTE_WAITLIST_URL =
  "https://agent-native.com/_agent-native/builder/branch-waitlist";

function TargetIcon({ target }: { target: "local" | "worktree" | "remote" }) {
  if (target === "worktree") {
    return <IconGitBranch color="#a1a1aa" size={16} strokeWidth={1.8} />;
  }
  if (target === "remote") {
    return <IconCloud color="#a1a1aa" size={16} strokeWidth={1.8} />;
  }
  return <IconDeviceDesktop color="#a1a1aa" size={16} strokeWidth={1.8} />;
}

export function MobileWorkspaceControls({
  folder,
  target,
  onFolderChange,
  onTargetChange,
}: {
  folder: string;
  target: MobileExecutionTarget;
  onFolderChange: (folder: string) => void;
  onTargetChange: (target: MobileExecutionTarget) => void;
}) {
  const [targetOpen, setTargetOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const chooseTarget = (next: "local" | "worktree" | "remote") => {
    setTargetOpen(false);
    if (next === "remote") {
      setWaitlistOpen(true);
      return;
    }
    onTargetChange(next);
  };

  return (
    <>
      <View className="px-3 pb-1">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 h-10 flex-row items-center gap-2 rounded-xl bg-card-dark border border-border-dark px-3">
            <IconFolder color="#a1a1aa" size={16} strokeWidth={1.8} />
            <TextInput
              className="flex-1 text-white text-[13px]"
              value={folder}
              onChangeText={onFolderChange}
              placeholder="Choose folder"
              placeholderTextColor="#71717a"
              autoCapitalize="none"
              autoCorrect={false}
              numberOfLines={1}
              accessibilityLabel="Working folder"
            />
          </View>
          <Pressable
            className="h-10 min-w-[112px] flex-row items-center justify-center gap-1.5 rounded-xl bg-card-dark border border-border-dark px-3 active:bg-white/5"
            onPress={() => setTargetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Workspace target: ${target}`}
          >
            <TargetIcon target={target} />
            <Text className="text-zinc-300 text-[13px] font-medium">
              {target === "worktree" ? "Worktree" : "Local"}
            </Text>
            <IconChevronDown color="#71717a" size={14} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <Modal
        visible={targetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTargetOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={() => setTargetOpen(false)}
          accessibilityLabel="Dismiss workspace target menu"
        >
          <Pressable className="mx-3 mb-8 rounded-2xl bg-card-dark border border-border-dark overflow-hidden p-2">
            <View className="flex-row items-center justify-between px-3 py-2 border-b border-border-dark mb-1">
              <Text className="text-white text-[15px] font-semibold">
                Workspace
              </Text>
              <Pressable
                onPress={() => setTargetOpen(false)}
                className="p-1 active:opacity-75"
                accessibilityRole="button"
                accessibilityLabel="Close workspace menu"
              >
                <IconX color="#a1a1aa" size={18} strokeWidth={2} />
              </Pressable>
            </View>
            {[
              {
                id: "local" as const,
                label: "Local",
                description: "Use the selected folder directly",
              },
              {
                id: "worktree" as const,
                label: "Worktree",
                description: "Start an isolated copy from the latest commit",
              },
              {
                id: "remote" as const,
                label: "Remote",
                description: "Run in the cloud - join the waitlist",
              },
            ].map((option) => (
              <Pressable
                key={option.id}
                className="flex-row items-center gap-3 px-3 py-3 rounded-xl active:bg-white/5"
                onPress={() => chooseTarget(option.id)}
                accessibilityRole="button"
                accessibilityLabel={option.label}
              >
                <TargetIcon target={option.id} />
                <View className="flex-1">
                  <Text className="text-white text-[14px] font-medium">
                    {option.label}
                  </Text>
                  <Text className="text-zinc-500 text-[12px] mt-0.5">
                    {option.description}
                  </Text>
                </View>
                {option.id !== "remote" && option.id === target && (
                  <IconCheck color="#2563eb" size={16} strokeWidth={2.5} />
                )}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <RemoteWaitlistModal
        visible={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
      />
    </>
  );
}

function RemoteWaitlistModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setEmail("");
      setJoined(false);
      setError(null);
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const response = await fetch(REMOTE_WAITLIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          source: "mobile_code_agents",
          useCase: "mobile_remote_code_agent_waitlist",
        }),
      });
      if (!response.ok) {
        setError("Could not join the waitlist. Please try again.");
        return;
      }
      setJoined(true);
    } catch {
      setError("Could not join the waitlist. Please try again.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={onClose}
        accessibilityLabel="Dismiss remote waitlist"
      >
        <Pressable className="mx-3 mb-8 rounded-2xl bg-card-dark border border-border-dark p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-white text-[16px] font-semibold">
                Join the waitlist
              </Text>
              <Text className="text-zinc-400 text-[13px] leading-5 mt-1.5">
                Run code agents in the cloud from your phone.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              className="p-1 active:opacity-75"
              accessibilityRole="button"
              accessibilityLabel="Close remote waitlist"
            >
              <IconX color="#71717a" size={18} strokeWidth={2.2} />
            </Pressable>
          </View>
          {joined ? (
            <Text className="text-emerald-400 text-[13px] leading-5 mt-4">
              You are on the waitlist. We will email you when remote access
              opens.
            </Text>
          ) : (
            <>
              <TextInput
                className="h-11 rounded-xl bg-zinc-900 border border-zinc-800 px-3 text-white text-[14px] mt-4"
                value={email}
                onChangeText={(next) => {
                  setEmail(next);
                  setError(null);
                }}
                placeholder="you@company.com"
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel="Waitlist email"
              />
              {error ? (
                <Text className="text-red-400 text-[12px] mt-2">{error}</Text>
              ) : null}
              <Pressable
                className={`h-11 rounded-xl items-center justify-center mt-3 ${
                  email.trim() && !joining
                    ? "bg-white active:opacity-75"
                    : "bg-zinc-800"
                }`}
                disabled={!email.trim() || joining}
                onPress={() => void submit()}
                accessibilityRole="button"
                accessibilityLabel="Join remote waitlist"
              >
                {joining ? (
                  <ActivityIndicator size="small" color="#71717a" />
                ) : (
                  <Text
                    className={`text-[13px] font-bold ${
                      email.trim() ? "text-zinc-950" : "text-zinc-500"
                    }`}
                  >
                    Join waitlist
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
