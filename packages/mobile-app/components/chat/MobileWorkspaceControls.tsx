import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconDeviceDesktop,
  IconX,
} from "@tabler/icons-react-native";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import type { RemoteHost } from "@/lib/remote-sessions-api";

export type ChatTarget = "cloud" | "computer";

function TargetIcon({ target }: { target: ChatTarget }) {
  return target === "cloud" ? (
    <IconCloud color="#a1a1aa" size={15} strokeWidth={1.8} />
  ) : (
    <IconDeviceDesktop color="#a1a1aa" size={15} strokeWidth={1.8} />
  );
}

function TargetPill({
  target,
  selected,
  onPress,
}: {
  target: ChatTarget;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 active:opacity-75 ${
        selected ? "bg-white" : "bg-card-dark border border-border-dark"
      }`}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={
        target === "cloud" ? "Use cloud chat" : "Use a computer"
      }
    >
      {selected ? (
        <TargetIcon target={target} />
      ) : (
        <View className="opacity-75">
          <TargetIcon target={target} />
        </View>
      )}
      <Text
        className={`text-[12px] font-semibold ${
          selected ? "text-background-dark" : "text-text-light"
        }`}
      >
        {target === "cloud" ? "Cloud" : "Computer"}
      </Text>
    </Pressable>
  );
}

export function MobileWorkspaceControls({
  target,
  hosts,
  selectedHostId,
  onTargetChange,
  onHostChange,
  onConnectComputer,
}: {
  target: ChatTarget;
  hosts: RemoteHost[];
  selectedHostId?: string;
  onTargetChange: (target: ChatTarget) => void;
  onHostChange: (hostId: string) => void;
  onConnectComputer: () => void;
}) {
  const [hostOpen, setHostOpen] = useState(false);
  const selectedHost = hosts.find((host) => host.id === selectedHostId);

  return (
    <>
      <View className="flex-row items-center justify-between px-3 pb-1">
        <View className="flex-row items-center gap-1.5">
          <TargetPill
            target="cloud"
            selected={target === "cloud"}
            onPress={() => onTargetChange("cloud")}
          />
          <TargetPill
            target="computer"
            selected={target === "computer"}
            onPress={() => onTargetChange("computer")}
          />
        </View>

        {target === "computer" ? (
          <Pressable
            className="flex-row items-center gap-1.5 rounded-full px-2 py-1.5 active:opacity-75"
            onPress={() =>
              hosts.length ? setHostOpen(true) : onConnectComputer()
            }
            accessibilityRole="button"
            accessibilityLabel={
              selectedHost
                ? `Computer: ${selectedHost.name}`
                : "Connect a computer"
            }
          >
            <IconDeviceDesktop color="#a1a1aa" size={14} strokeWidth={1.8} />
            <Text
              className="max-w-[130px] text-status-gray text-[12px] font-medium"
              numberOfLines={1}
            >
              {selectedHost?.name ?? "Connect computer"}
            </Text>
            {hosts.length ? (
              <IconChevronDown color="#71717a" size={13} strokeWidth={2} />
            ) : null}
          </Pressable>
        ) : (
          <Text className="text-status-gray text-[12px]">All apps</Text>
        )}
      </View>

      <Modal
        visible={hostOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHostOpen(false)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/60"
          onPress={() => setHostOpen(false)}
          accessibilityLabel="Dismiss computer picker"
        >
          <Pressable className="mx-3 overflow-hidden rounded-2xl border border-border-dark bg-card-dark">
            <SafeAreaView edges={["bottom"]}>
              <View className="flex-row items-center justify-between border-b border-border-dark px-4 py-3">
                <Text className="text-white text-[15px] font-semibold">
                  Computer
                </Text>
                <Pressable
                  className="p-1 active:opacity-75"
                  onPress={() => setHostOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close computer picker"
                >
                  <IconX color="#71717a" size={18} strokeWidth={2.2} />
                </Pressable>
              </View>
              {hosts.map((host) => (
                <Pressable
                  key={host.id}
                  className="flex-row items-center gap-3 border-b border-border-dark px-4 py-3.5 active:bg-white/5"
                  onPress={() => {
                    onHostChange(host.id);
                    setHostOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: host.id === selectedHostId }}
                  accessibilityLabel={host.name}
                >
                  <View className="h-8 w-8 items-center justify-center rounded-lg bg-gray-medium-dark">
                    <IconDeviceDesktop
                      color="#d4d4d8"
                      size={17}
                      strokeWidth={1.8}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[14px] font-medium">
                      {host.name}
                    </Text>
                    <Text className="text-status-gray text-[12px] mt-0.5">
                      {host.status === "online" ? "Available" : host.status}
                    </Text>
                  </View>
                  {host.id === selectedHostId ? (
                    <IconCheck color="#d4d4d8" size={17} strokeWidth={2.2} />
                  ) : null}
                </Pressable>
              ))}
              <Pressable
                className="flex-row items-center justify-center px-4 py-3.5 active:bg-white/5"
                onPress={() => {
                  setHostOpen(false);
                  onConnectComputer();
                }}
                accessibilityRole="button"
                accessibilityLabel="Manage connected computers"
              >
                <Text className="text-text-light text-[13px] font-semibold">
                  Manage computers
                </Text>
              </Pressable>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
