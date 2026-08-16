import { Modal, Pressable, Text, View } from "react-native";

import {
  ModalSafeAreaProvider,
  SafeAreaView,
} from "@/components/uniwind-interop";

export function ComputerConnectSheet({
  visible,
  onClose,
  onRefresh,
}: {
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <ModalSafeAreaProvider style={{ flex: 1 }}>
        <View className="flex-1 justify-end bg-black/55">
          <Pressable
            className="flex-1"
            onPress={onClose}
            accessibilityLabel="Dismiss computer connection"
          />
          <SafeAreaView
            edges={["bottom"]}
            className="rounded-t-[26px] border border-border-dark bg-card-dark px-5 pt-3"
          >
            <View className="self-center h-1 w-10 rounded-full bg-zinc-600" />
            <View className="flex-row items-center justify-between py-4">
              <Text className="text-foreground text-[20px] font-semibold">
                Connect computer
              </Text>
              <Pressable
                className="px-1 py-1 active:opacity-75"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close computer connection"
              >
                <Text className="text-text-muted text-[15px] font-medium">
                  Close
                </Text>
              </Pressable>
            </View>
            <Text className="mb-5 text-text-muted text-[15px] leading-6">
              Open Agent Native Desktop on your laptop and sign in with this
              account. When it appears here, choose it from the computer menu.
            </Text>
            <Pressable
              className="mb-3 h-12 items-center justify-center rounded-xl bg-primary active:opacity-75"
              onPress={() => void onRefresh()}
              accessibilityRole="button"
              accessibilityLabel="Refresh computers"
            >
              <Text className="text-primary-foreground text-[15px] font-semibold">
                Refresh computers
              </Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </ModalSafeAreaProvider>
    </Modal>
  );
}
