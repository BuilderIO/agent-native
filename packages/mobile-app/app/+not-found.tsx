import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";

export default function NotFoundScreen() {
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
        <Link href="/chat" asChild>
          <Pressable className="bg-primary rounded-xl px-5 py-3 mt-7 active:opacity-75">
            <Text className="text-primary-foreground text-sm font-bold">
              Back to Chat
            </Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}
