import { Pressable, Text, View } from "react-native";

import { MobileSheet } from "@/components/MobileSheet";
import { SafeAreaView } from "@/components/uniwind-interop";

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
    <MobileSheet
      visible={visible}
      onClose={onClose}
      motion="sheet"
      contentClassName="rounded-t-[26px] border border-border bg-card px-5 pt-3"
      overlayClassName="bg-black/55"
      accessibilityLabel="Dismiss computer connection"
    >
      <SafeAreaView edges={["bottom"]}>
        <View className="self-center h-1 w-10 rounded-full bg-muted-foreground/40" />
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
            <Text className="text-muted-foreground text-[15px] font-medium">
              Close
            </Text>
          </Pressable>
        </View>
        <Text className="mb-5 text-muted-foreground text-[15px] leading-6">
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
    </MobileSheet>
  );
}
