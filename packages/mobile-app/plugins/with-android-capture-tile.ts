import {
  AndroidConfig,
  type ConfigPlugin,
  XML,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} from "expo/config-plugins";

declare const require: (moduleName: "node:fs/promises") => {
  mkdir: (directory: string, options: { recursive: true }) => Promise<unknown>;
  writeFile: (file: string, contents: string) => Promise<void>;
};

const { mkdir, writeFile } = require("node:fs/promises");

const TILE_SERVICE_CLASS = "AgentNativeCaptureTileService";
const TILE_SERVICE_NAME = `.${TILE_SERVICE_CLASS}`;
const TILE_ICON_RESOURCE = "@drawable/ic_agent_native_capture_tile";
const TILE_LABEL_RESOURCE = "@string/agent_native_capture_tile_label";

function createTileServiceSource(androidPackage: string) {
  return `package ${androidPackage}

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class ${TILE_SERVICE_CLASS} : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      label = getString(R.string.agent_native_capture_tile_label)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        contentDescription = getString(R.string.agent_native_capture_tile_description)
      }
      updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    unlockAndRun(Runnable { openDictation() })
  }

  private fun openDictation() {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("agentnative://capture/dictate")).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val pendingIntent = PendingIntent.getActivity(
        this,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      startActivityAndCollapse(pendingIntent)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
`;
}

const withAndroidCaptureTile: ConfigPlugin = (config) => {
  const androidPackage = AndroidConfig.Package.getPackage(config);
  if (!androidPackage) {
    throw new Error(
      "with-android-capture-tile requires expo.android.package to generate the tile service.",
    );
  }

  config = withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );
    const services = application.service ?? [];
    const tileService = {
      $: {
        "android:name": TILE_SERVICE_NAME,
        "android:exported": "true",
        "android:icon": TILE_ICON_RESOURCE,
        "android:label": TILE_LABEL_RESOURCE,
        "android:permission": "android.permission.BIND_QUICK_SETTINGS_TILE",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.service.quicksettings.action.QS_TILE",
              },
            },
          ],
        },
      ],
    } as unknown as (typeof services)[number];

    application.service = [
      ...services.filter(
        (service) => service.$["android:name"] !== TILE_SERVICE_NAME,
      ),
      tileService,
    ];

    return manifestConfig;
  });

  config = withStringsXml(config, (stringsConfig) => {
    const strings = [
      AndroidConfig.Resources.buildResourceItem({
        name: "agent_native_capture_tile_label",
        value: "Start Dictation",
        translatable: true,
      }),
      AndroidConfig.Resources.buildResourceItem({
        name: "agent_native_capture_tile_description",
        value: "Start dictation in Agent Native",
        translatable: true,
      }),
    ];
    stringsConfig.modResults = AndroidConfig.Strings.setStringItem(
      strings,
      stringsConfig.modResults,
    );
    return stringsConfig;
  });

  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const sourceRoot = `${androidConfig.modRequest.platformProjectRoot}/app/src/main`;
      const kotlinDirectory = `${sourceRoot}/java/${androidPackage.replaceAll(".", "/")}`;
      const drawableDirectory = `${sourceRoot}/res/drawable`;

      await Promise.all([
        mkdir(kotlinDirectory, { recursive: true }),
        mkdir(drawableDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          `${kotlinDirectory}/${TILE_SERVICE_CLASS}.kt`,
          createTileServiceSource(androidPackage),
        ),
        XML.writeXMLAsync({
          path: `${drawableDirectory}/ic_agent_native_capture_tile.xml`,
          xml: {
            vector: {
              $: {
                "xmlns:android": "http://schemas.android.com/apk/res/android",
                "android:width": "24dp",
                "android:height": "24dp",
                "android:viewportWidth": "24",
                "android:viewportHeight": "24",
              },
              path: [
                {
                  $: {
                    "android:fillColor": "#FFFFFFFF",
                    "android:pathData":
                      "M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11H5c0,3.41 2.72,6.23 6,6.72V21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z",
                  },
                },
              ],
            },
          },
        }),
      ]);

      return androidConfig;
    },
  ]);
};

export default createRunOncePlugin(
  withAndroidCaptureTile,
  "with-android-capture-tile",
  "1.0.0",
);
