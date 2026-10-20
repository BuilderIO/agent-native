# Documentation proof checklist

For each documentation row, copy its commands into a clean temporary scaffold.
Verify referenced files, directories, scripts, environment variables, deploy
targets, links, and fenced-command order. Update configured locales when source
meaning changes. Run `guard:i18n-catalogs` and `guard:i18n-changed-copy`; a docs
diff or build alone is not proof.
