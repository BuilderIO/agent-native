import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#111111" },
          headerTintColor: "#ffffff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#111111" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="app/[id]"
          options={{
            headerShown: true,
            headerBackTitle: "Apps",
          }}
        />
      </Stack>
    </>
  );
}
