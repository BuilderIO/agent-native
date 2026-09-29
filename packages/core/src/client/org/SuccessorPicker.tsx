import { Button } from "@agent-native/toolkit/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconCheck, IconSelector } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { useT } from "../i18n.js";
import {
  useShareOrgMemberSearch,
  type ShareOrgMember,
} from "../sharing/share-controller-helpers.js";
import { cn } from "../utils.js";

/**
 * Picks who receives a removed member's data. It searches the whole
 * organization on the server: a page of the member list would leave anyone
 * past that page impossible to choose.
 */
export function SuccessorPicker({
  id,
  value,
  onChange,
  excludeEmail,
  currentUser,
  disabled,
  size = "default",
  className,
}: {
  id?: string;
  value: ShareOrgMember | null;
  onChange: (member: ShareOrgMember) => void;
  /** The member being removed, who can't receive their own data. */
  excludeEmail: string;
  /** Offered first, so the default choice is always available. */
  currentUser: ShareOrgMember;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useShareOrgMemberSearch(query, open, { limit: 50 });
  const excluded = excludeEmail.toLowerCase();

  const options = useMemo(() => {
    const seen = new Set<string>([excluded]);
    const list: ShareOrgMember[] = [];
    const add = (member: ShareOrgMember) => {
      const key = member.email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push(member);
    };
    if (!query.trim()) add(currentUser);
    for (const member of search.members) add(member);
    return list;
  }, [currentUser, excluded, query, search.members]);

  const label = (member: ShareOrgMember) => member.name?.trim() || member.email;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size={size}
          role="combobox"
          aria-expanded={open}
          aria-label={t("org.transferTo")}
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className="truncate">
            {value ? label(value) : t("org.transferTo")}
          </span>
          <IconSelector aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("org.searchPeople", {
              defaultValue: "Search people",
            })}
          />
          <CommandList aria-busy={search.isLoading}>
            {search.isLoading && options.length === 0 ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>
                {t("org.noPeopleFound", { defaultValue: "No people found" })}
              </CommandEmpty>
            )}
            <CommandGroup>
              {options.map((member) => (
                <CommandItem
                  key={member.email}
                  value={member.email}
                  onSelect={() => {
                    onChange(member);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {label(member)}
                  </span>
                  <IconCheck
                    aria-hidden="true"
                    className={cn(
                      "ms-auto",
                      value?.email.toLowerCase() === member.email.toLowerCase()
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
              {search.hasMore ? (
                <CommandItem
                  value="__load-more__"
                  disabled={search.isLoadingMore}
                  onSelect={() => search.loadMore()}
                  className="justify-center text-muted-foreground"
                >
                  {search.isLoadingMore ? <Spinner /> : null}
                  {t("org.loadMorePeople", { defaultValue: "Load more" })}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
