import { CameraView as CameraViewBase } from "expo-camera";
import { VideoView as VideoViewBase } from "expo-video";
import {
  SafeAreaProvider as SafeAreaProviderBase,
  SafeAreaView as SafeAreaViewBase,
} from "react-native-safe-area-context";
import { WebView as WebViewBase } from "react-native-webview";
import { withUniwind } from "uniwind";

export const CameraView = withUniwind(CameraViewBase);
export const ModalSafeAreaProvider = SafeAreaProviderBase;
export const SafeAreaView = withUniwind(SafeAreaViewBase);
export const VideoView = withUniwind(VideoViewBase);
export const WebView = withUniwind(WebViewBase);
