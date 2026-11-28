import { useT } from "@agent-native/core/client/i18n";
import {
  FilterMenu,
  FilterMenuWords,
  isDefaultFilterState,
  useFilterUrlState,
  type FilterField,
} from "@agent-native/toolkit/app/filters";
import {
  INBOX_FILTER_LABELS_EN,
  inboxFilterFields,
} from "@shared/inbox-filters";
import { IconMail, IconStar } from "@tabler/icons-react";
import { type ReactNode, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

const URL_FIELDS = inboxFilterFields(INBOX_FILTER_LABELS_EN);

const FIELD_ICONS: Partial<Record<string, ReactNode>> = {
  unread: <IconMail />,
  starred: <IconStar />,
};

export function InboxFilterMenu() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const onSearchChange = useCallback(
    (search: string, { replace }: { replace: boolean }) => {
      void navigate(
        { pathname: location.pathname, search, hash: location.hash },
        { replace },
      );
    },
    [location.hash, location.pathname, navigate],
  );
  const { state, setState } = useFilterUrlState({
    fields: URL_FIELDS,
    search: location.search,
    onSearchChange,
  });
  const fields = useMemo<FilterField<never>[]>(
    () =>
      inboxFilterFields({
        unread: t("mail.views.unread"),
        starred: t("mail.views.starred"),
      }).map((field) => ({ ...field, icon: FIELD_ICONS[field.id] })),
    [t],
  );
  return (
    <FilterMenu
      fields={fields}
      state={state}
      onChange={setState}
      hint={
        isDefaultFilterState(state, URL_FIELDS) ? undefined : (
          <FilterMenuWords fields={fields} state={state} />
        )
      }
    />
  );
}
