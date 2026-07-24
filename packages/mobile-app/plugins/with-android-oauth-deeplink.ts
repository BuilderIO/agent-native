import {
  AndroidConfig,
  type ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
  withMainActivity,
} from "expo/config-plugins";

const OAUTH_SCHEME = "agentnative";
const OAUTH_HOST = "oauth-complete";

// Declares agentnative://oauth-complete as an explicit deep link on MainActivity
// so the Google OAuth redirect is reliably delivered to the app.
const withOAuthIntentFilter: ConfigPlugin = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults,
    );
    const mainActivity = application.activity?.find(
      (activity) => activity.$?.["android:name"] === ".MainActivity",
    );
    if (mainActivity) {
      const filters = mainActivity["intent-filter"] ?? [];
      const alreadyDeclared = filters.some((filter) =>
        (filter.data ?? []).some(
          (data) => data.$?.["android:host"] === OAUTH_HOST,
        ),
      );
      if (!alreadyDeclared) {
        filters.push({
          action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
          category: [
            { $: { "android:name": "android.intent.category.DEFAULT" } },
            { $: { "android:name": "android.intent.category.BROWSABLE" } },
          ],
          data: [
            {
              $: {
                "android:scheme": OAUTH_SCHEME,
                "android:host": OAUTH_HOST,
              },
            },
          ],
        } as unknown as (typeof filters)[number]);
        mainActivity["intent-filter"] = filters;
      }
    }
    return cfg;
  });

// MainActivity uses launchMode=singleTask, so a deep link arrives via
// onNewIntent rather than a fresh onCreate. Without updating the activity's
// intent, React Native's Linking.getInitialURL() reads the stale launch intent
// and returns null, so the OAuth redirect URL never reaches JS.
const withOnNewIntent: ConfigPlugin = (config) =>
  withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error(
        "with-android-oauth-deeplink expects a Kotlin MainActivity.",
      );
    }
    let contents = cfg.modResults.contents;
    if (contents.includes("onNewIntent")) return cfg;

    if (!contents.includes("import android.content.Intent")) {
      contents = contents.replace(
        /^(package [^\n]+\n)/m,
        "$1\nimport android.content.Intent\n",
      );
    }

    const method = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;
    const lastBrace = contents.lastIndexOf("}");
    contents =
      contents.slice(0, lastBrace) + method + contents.slice(lastBrace);

    cfg.modResults.contents = contents;
    return cfg;
  });

const withAndroidOAuthDeepLink: ConfigPlugin = (config) => {
  config = withOAuthIntentFilter(config);
  config = withOnNewIntent(config);
  return config;
};

export default createRunOncePlugin(
  withAndroidOAuthDeepLink,
  "with-android-oauth-deeplink",
  "1.0.0",
);
