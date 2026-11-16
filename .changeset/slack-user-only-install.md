---
"@agent-native/core": patch
---

Add a user-only Slack install. `/_agent-native/integrations/slack/oauth/install?mode=user` requests read-only Slack user scopes with no bot scope, and the callback stores the returned user token as a personal integration grant instead of a bot installation. It is off by default: set `integrations.slackInternalTeamIds` (env `SLACK_INTERNAL_TEAM_IDS`) to the workspaces allowed to use it, or turn on `integrations.slackUserInstallBootstrap` (env `SLACK_USER_INSTALL_BOOTSTRAP`) for the first install while the workspace id is still unknown. The bot install path is unchanged.
