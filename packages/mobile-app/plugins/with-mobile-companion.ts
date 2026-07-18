import {
  AndroidConfig,
  CodeGenerator,
  type ConfigPlugin,
  XML,
  createRunOncePlugin,
  withAndroidManifest,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withStringsXml,
} from "expo/config-plugins";

const IOS_PERMISSION_DESCRIPTIONS = {
  NSCameraUsageDescription:
    "Agent Native uses the camera to capture photos and videos for your agents.",
  NSMicrophoneUsageDescription:
    "Agent Native uses the microphone to record audio and video and to dictate to your agents.",
  NSPhotoLibraryAddUsageDescription:
    "Agent Native saves captured photos and videos to your photo library when you ask it to.",
  NSPhotoLibraryUsageDescription:
    "Agent Native accesses photos and videos you choose to share with your agents.",
} as const;

const ANDROID_PERMISSIONS = [
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
] as const;

const QUICK_ACTIONS = [
  {
    id: "capture_audio",
    url: "agentnative://capture/audio",
    title: "Record Audio",
    longTitle: "Record Audio for Agent Native",
    iosIcon: "UIApplicationShortcutIconTypeAudio",
  },
  {
    id: "capture_video",
    url: "agentnative://capture/video",
    title: "Capture Video",
    longTitle: "Capture Video for Agent Native",
    iosIcon: "UIApplicationShortcutIconTypeCaptureVideo",
  },
  {
    id: "capture_dictate",
    url: "agentnative://capture/dictate",
    title: "Start Dictation",
    longTitle: "Start Dictation with Agent Native",
    iosIcon: "UIApplicationShortcutIconTypeCompose",
  },
] as const;

const ANDROID_SHORTCUTS_RESOURCE = "@xml/agent_native_shortcuts";
const ANDROID_SHORTCUTS_METADATA = "android.app.shortcuts";
const IOS_SHORTCUT_ROUTER_TAG = "agent-native-shortcut-router";
const IOS_SHORTCUT_LAUNCH_TAG = "agent-native-shortcut-cold-launch";
const IOS_SHORTCUT_CALLBACK_TAG = "agent-native-shortcut-warm-launch";

type AndroidActivityWithMetadata = ReturnType<
  typeof AndroidConfig.Manifest.getMainActivityOrThrow
> & {
  "meta-data"?: Array<{
    $: {
      "android:name": string;
      "android:resource"?: string;
    };
  }>;
};

function addIosShortcutRouting(source: string) {
  const supportedUrls = QUICK_ACTIONS.map(
    (action) => `    "${action.url}",`,
  ).join("\n");
  let contents = CodeGenerator.mergeContents({
    tag: IOS_SHORTCUT_ROUTER_TAG,
    src: source,
    newSrc: `private enum AgentNativeShortcutRouter {
  private static let supportedURLs = Set([
${supportedUrls}
  ])

  static func url(from shortcutItem: UIApplicationShortcutItem?) -> URL? {
    guard let shortcutItem else {
      return nil
    }

    let rawURL = (shortcutItem.userInfo?["url"] as? String) ?? shortcutItem.type
    guard supportedURLs.contains(rawURL) else {
      return nil
    }

    return URL(string: rawURL)
  }
}`,
    anchor: /^@(main|UIApplicationMain)$/m,
    offset: 0,
    comment: "//",
  }).contents;

  contents = CodeGenerator.mergeContents({
    tag: IOS_SHORTCUT_LAUNCH_TAG,
    src: contents,
    newSrc: `    let agentNativeShortcutURL = AgentNativeShortcutRouter.url(
      from: launchOptions?[.shortcutItem] as? UIApplicationShortcutItem
    )
    var agentNativeLaunchOptions = launchOptions
    if let agentNativeShortcutURL {
      agentNativeLaunchOptions = agentNativeLaunchOptions ?? [:]
      agentNativeLaunchOptions?[.url] = agentNativeShortcutURL
    }`,
    anchor: /^    let delegate = ReactNativeDelegate\(\)$/m,
    offset: 0,
    comment: "//",
  }).contents;

  contents = contents.replaceAll(
    "launchOptions: launchOptions",
    "launchOptions: agentNativeLaunchOptions",
  );

  const superReturns = [
    "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
    "    return super.application(application, didFinishLaunchingWithOptions: agentNativeLaunchOptions)",
  ];
  const superReturn = superReturns.find((candidate) =>
    contents.includes(candidate),
  );
  if (superReturn) {
    contents = contents.replace(
      superReturn,
      `    let didFinish = super.application(
      application,
      didFinishLaunchingWithOptions: agentNativeLaunchOptions
    )
    return agentNativeShortcutURL == nil ? didFinish : false`,
    );
  } else if (!contents.includes("return agentNativeShortcutURL == nil")) {
    throw new Error(
      "with-mobile-companion could not update AppDelegate cold-launch handling.",
    );
  }

  return CodeGenerator.mergeContents({
    tag: IOS_SHORTCUT_CALLBACK_TAG,
    src: contents,
    newSrc: `  public override func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let url = AgentNativeShortcutRouter.url(from: shortcutItem) else {
      super.application(
        application,
        performActionFor: shortcutItem,
        completionHandler: completionHandler
      )
      return
    }

    let handled = RCTLinkingManager.application(
      application,
      open: url,
      options: [:]
    )
    super.application(
      application,
      performActionFor: shortcutItem,
      completionHandler: { subscriberHandled in
        completionHandler(handled || subscriberHandled)
      }
    )
  }
`,
    anchor: /^  \/\/ Linking API$/m,
    offset: 0,
    comment: "//",
  }).contents;
}

function withIosCompanion(config: Parameters<ConfigPlugin>[0]) {
  config = withInfoPlist(config, (infoPlistConfig) => {
    Object.assign(infoPlistConfig.modResults, IOS_PERMISSION_DESCRIPTIONS);

    const backgroundModes = Array.isArray(
      infoPlistConfig.modResults.UIBackgroundModes,
    )
      ? infoPlistConfig.modResults.UIBackgroundModes.filter(
          (mode): mode is string => typeof mode === "string",
        )
      : [];
    infoPlistConfig.modResults.UIBackgroundModes = [
      ...new Set([...backgroundModes, "audio"]),
    ];

    const quickActionUrls = new Set<string>(
      QUICK_ACTIONS.map((action) => action.url),
    );
    const existingQuickActions = Array.isArray(
      infoPlistConfig.modResults.UIApplicationShortcutItems,
    )
      ? infoPlistConfig.modResults.UIApplicationShortcutItems.filter(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            !quickActionUrls.has(
              String(item.UIApplicationShortcutItemType ?? ""),
            ),
        )
      : [];

    infoPlistConfig.modResults.UIApplicationShortcutItems = [
      ...existingQuickActions,
      ...QUICK_ACTIONS.map((action) => ({
        UIApplicationShortcutItemIconType: action.iosIcon,
        UIApplicationShortcutItemTitle: action.title,
        UIApplicationShortcutItemType: action.url,
        UIApplicationShortcutItemUserInfo: { url: action.url },
      })),
    ];

    return infoPlistConfig;
  });

  return withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== "swift") {
      throw new Error(
        "with-mobile-companion requires the Expo SDK 57 Swift AppDelegate template.",
      );
    }
    appDelegateConfig.modResults.contents = addIosShortcutRouting(
      appDelegateConfig.modResults.contents,
    );
    return appDelegateConfig;
  });
}

function withAndroidCompanion(config: Parameters<ConfigPlugin>[0]) {
  const androidPackage = AndroidConfig.Package.getPackage(config);
  if (!androidPackage) {
    throw new Error(
      "with-mobile-companion requires expo.android.package to generate Android shortcuts.",
    );
  }

  config = withAndroidManifest(config, (manifestConfig) => {
    AndroidConfig.Permissions.ensurePermissions(manifestConfig.modResults, [
      ...ANDROID_PERMISSIONS,
    ]);

    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      manifestConfig.modResults,
    ) as AndroidActivityWithMetadata;
    mainActivity["meta-data"] = [
      ...(mainActivity["meta-data"] ?? []).filter(
        (item) => item.$["android:name"] !== ANDROID_SHORTCUTS_METADATA,
      ),
      {
        $: {
          "android:name": ANDROID_SHORTCUTS_METADATA,
          "android:resource": ANDROID_SHORTCUTS_RESOURCE,
        },
      },
    ];

    return manifestConfig;
  });

  config = withStringsXml(config, (stringsConfig) => {
    const labels = QUICK_ACTIONS.flatMap((action) => [
      AndroidConfig.Resources.buildResourceItem({
        name: `agent_native_shortcut_${action.id}_short`,
        value: action.title,
        translatable: true,
      }),
      AndroidConfig.Resources.buildResourceItem({
        name: `agent_native_shortcut_${action.id}_long`,
        value: action.longTitle,
        translatable: true,
      }),
    ]);
    stringsConfig.modResults = AndroidConfig.Strings.setStringItem(
      labels,
      stringsConfig.modResults,
    );
    return stringsConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const resourceFolder = await AndroidConfig.Paths.getResourceFolderAsync(
        androidConfig.modRequest.projectRoot,
      );
      await XML.writeXMLAsync({
        path: `${resourceFolder}/xml/agent_native_shortcuts.xml`,
        xml: {
          shortcuts: {
            $: {
              "xmlns:android": "http://schemas.android.com/apk/res/android",
            },
            shortcut: QUICK_ACTIONS.map((action) => ({
              $: {
                "android:enabled": "true",
                "android:icon": "@mipmap/ic_launcher",
                "android:shortcutId": action.id,
                "android:shortcutLongLabel": `@string/agent_native_shortcut_${action.id}_long`,
                "android:shortcutShortLabel": `@string/agent_native_shortcut_${action.id}_short`,
              },
              intent: [
                {
                  $: {
                    "android:action": "android.intent.action.VIEW",
                    "android:data": action.url,
                    "android:targetClass": `${androidPackage}.MainActivity`,
                    "android:targetPackage": androidPackage,
                  },
                },
              ],
            })),
          },
        },
      });
      return androidConfig;
    },
  ]);
}

const withMobileCompanion: ConfigPlugin = (config) =>
  withAndroidCompanion(withIosCompanion(config));

export default createRunOncePlugin(
  withMobileCompanion,
  "with-mobile-companion",
  "1.1.0",
);
