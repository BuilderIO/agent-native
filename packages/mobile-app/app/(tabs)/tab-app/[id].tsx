import { View } from "react-native";

import { useTabBarLayout } from "@/lib/tab-bar-layout";

import AppScreen from "../../app/[id]";

export default function TabAppScreen() {
  const { contentInset } = useTabBarLayout();

  return (
    <View style={{ flex: 1, paddingBottom: contentInset }}>
      <AppScreen />
    </View>
  );
}
