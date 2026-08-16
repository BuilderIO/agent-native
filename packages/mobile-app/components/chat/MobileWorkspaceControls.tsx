import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react-native";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import {
  ModalSafeAreaProvider,
  SafeAreaView,
} from "@/components/uniwind-interop";
import type { RemoteHost } from "@/lib/remote-sessions-api";

export type ChatTarget = "cloud" | "computer";

function TargetOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center justify-between border-b border-border-dark px-4 py-3.5 active:bg-white/5"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text
        className={`text-[15px] ${
          selected ? "font-semibold text-white" : "text-text-light"
        }`}
      >
        {label}
      </Text>
      {selected ? (
        <IconCheck color="#f4f4f5" size={17} strokeWidth={2.2} />
      ) : null}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedHost = hosts.find((host) => host.id === selectedHostId);

  return (
    <>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-1">
        <Pressable
          className="flex-row items-center gap-1.5 rounded-lg border border-border-dark bg-card-dark px-2.5 py-1.5 active:opacity-75"
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Chat target: ${target === "cloud" ? "Cloud" : "Computer"}`}
        >
          <Text className="text-text-light text-[13px] font-semibold">
            {target === "cloud" ? "Cloud" : "Computer"}
          </Text>
          <IconChevronDown color="#71717a" size={14} strokeWidth={2} />
        </Pressable>
        {target === "computer" ? (
          <Pressable
            className="max-w-[180px] flex-row items-center gap-1 rounded-lg px-1.5 py-1.5 active:opacity-75"
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              selectedHost
                ? `Computer: ${selectedHost.name}`
                : "Connect computer"
            }
          >
            <Text className="text-status-gray text-[13px]" numberOfLines={1}>
              {selectedHost?.name ?? "Connect computer"}
            </Text>
            {hosts.length ? (
              <IconChevronDown color="#71717a" size={13} strokeWidth={2} />
            ) : null}
          </Pressable>
        ) : null}
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <ModalSafeAreaProvider style={{ flex: 1 }}>
          <Pressable
            className="flex-1 justify-end bg-black/45"
            onPress={() => setMenuOpen(false)}
            accessibilityLabel="Dismiss chat target picker"
          >
            <Pressable className="mx-3 mb-28 overflow-hidden rounded-2xl border border-border-dark bg-card-dark shadow-2xl">
              <SafeAreaView edges={["bottom"]}>
                <View className="flex-row items-center justify-between border-b border-border-dark px-4 py-3">
                  <Text className="text-white text-[15px] font-semibold">
                    Chat with
                  </Text>
                  <Pressable
                    className="p-1 active:opacity-75"
                    onPress={() => setMenuOpen(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Close chat target picker"
                  >
                    <IconX color="#71717a" size={18} strokeWidth={2.2} />
                  </Pressable>
                </View>
                <TargetOption
                  label="Cloud"
                  selected={target === "cloud"}
                  onPress={() => {
                    onTargetChange("cloud");
                    setMenuOpen(false);
                  }}
                />
                <TargetOption
                  label="Computer"
                  selected={target === "computer"}
                  onPress={() => onTargetChange("computer")}
                />
                {target === "computer" ? (
                  <>
                    {hosts.map((host) => (
                      <Pressable
                        key={host.id}
                        className="flex-row items-center justify-between border-b border-border-dark px-4 py-3.5 pl-7 active:bg-white/5"
                        onPress={() => {
                          onHostChange(host.id);
                          setMenuOpen(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{
                          selected: host.id === selectedHostId,
                        }}
                        accessibilityLabel={host.name}
                      >
                        <View className="flex-1">
                          <Text className="text-text-light text-[14px]">
                            {host.name}
                          </Text>
                          <Text className="mt-0.5 text-status-gray text-[12px]">
                            {host.status === "online"
                              ? "Available"
                              : host.status}
                          </Text>
                        </View>
                        {host.id === selectedHostId ? (
                          <IconCheck
                            color="#f4f4f5"
                            size={16}
                            strokeWidth={2.2}
                          />
                        ) : null}
                      </Pressable>
                    ))}
                    <Pressable
                      className="items-center px-4 py-3.5 active:bg-white/5"
                      onPress={() => {
                        setMenuOpen(false);
                        onConnectComputer();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Connect a computer"
                    >
                      <Text className="text-text-light text-[13px] font-semibold">
                        {hosts.length ? "Manage computers" : "Connect computer"}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </SafeAreaView>
            </Pressable>
          </Pressable>
        </ModalSafeAreaProvider>
      </Modal>
    </>
  );
}
