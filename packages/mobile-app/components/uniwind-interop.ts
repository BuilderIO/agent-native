import { SafeAreaView as SafeAreaViewBase } from "react-native-safe-area-context";
import { WebView as WebViewBase } from "react-native-webview";
import { withUniwind } from "uniwind";

// Uniwind's metro resolver only rewrites `react-native` imports to
// className-aware components. Third-party components silently drop
// `className`, so import these wrapped versions instead of the raw packages.
export const SafeAreaView = withUniwind(SafeAreaViewBase);
export const WebView = withUniwind(WebViewBase);
