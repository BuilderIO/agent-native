import { Pressable, Text, View } from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import { useMobileNavigation } from "@/lib/navigation";

export default function NotFoundScreen() {
  const navigation = useMobileNavigation();
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      className="flex-1 bg-background-dark"
    >
      <View className="flex-1 items-center justify-center px-7.5">
        <Text className="text-text-muted text-xs font-bold tracking-[2px]">
          ROUTE NOT FOUND
        </Text>
        <Text className="text-white text-2xl font-bold tracking-tight mt-2.5 text-center">
          This page is unavailable.
        </Text>
        <Pressable
          className="bg-primary rounded-xl px-5 py-3 mt-7 active:opacity-75"
          onPress={() => navigation.replace("/chat")}
        >
          <Text className="text-primary-foreground text-sm font-bold">
            Back to Chat
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
