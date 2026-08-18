import { CameraView as CameraViewBase } from "expo-camera";
import { VideoView as VideoViewBase } from "expo-video";
import {
  SafeAreaProvider as SafeAreaProviderBase,
  SafeAreaView as SafeAreaViewBase,
} from "react-native-safe-area-context";
import { WebView as WebViewBase } from "react-native-webview";
import { withUniwind } from "uniwind";

// Uniwind's metro resolver only rewrites `react-native` imports to
// className-aware components. Third-party components silently drop
// `className`, so import these wrapped versions instead of the raw packages.
export const CameraView = withUniwind(CameraViewBase);
// React Native Modal creates a separate native root, so modal content needs
// its own provider instead of relying on the app-level provider.
export const ModalSafeAreaProvider = SafeAreaProviderBase;
export const SafeAreaView = withUniwind(SafeAreaViewBase);
export const VideoView = withUniwind(VideoViewBase);
export const WebView = withUniwind(WebViewBase);
