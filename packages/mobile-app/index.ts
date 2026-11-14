import "react-native-gesture-handler";

if (
  typeof window !== "undefined" &&
  typeof window.addEventListener !== "function"
) {
  window.addEventListener = () => {};
  window.removeEventListener = () => {};
}

require("expo-router/entry");
