import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconPlus,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ViewportChoice = "desktop" | "mobile";

const VIEWPORT_SIZES: Record<
  ViewportChoice,
  { width: number; height: number }
> = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

interface LocalhostRouteOption {
  path: string;
  title?: string;
}

function normalizeCustomPath(value: string): string {
  if (!value || /^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

export interface AddLocalhostScreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  connectionId?: string;
  /** Used only when the connection's route manifest has no routes. */
  fallbackPaths?: string[];
  /** Canvas placement for the new frame; defaults to (0, 0). */
  position?: { x: number; y: number };
}

export function AddLocalhostScreenDialog({
  open,
  onOpenChange,
  designId,
  connectionId,
  fallbackPaths,
  position,
}: AddLocalhostScreenDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [viewport, setViewport] = useState<ViewportChoice>("desktop");
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    connectionId ?? "",
  );

  const { data: connectionResult } = useActionQuery<{
    connections?: Array<{
      id: string;
      name?: string | null;
      devServerUrl?: string | null;
      routes?: Array<{ path: string; title?: string }>;
    }>;
  }>(
    "list-localhost-connections",
    { designId, ...(connectionId ? { id: connectionId } : {}) },
    { enabled: open },
  );

  useEffect(() => {
    if (!open) return;
    if (connectionId) {
      setSelectedConnectionId(connectionId);
      return;
    }
    const connections = connectionResult?.connections ?? [];
    if (connections.length === 1) {
      setSelectedConnectionId(connections[0]?.id ?? "");
    }
  }, [connectionId, connectionResult?.connections, open]);

  const effectiveConnectionId = connectionId || selectedConnectionId;
  const availableConnections = connectionResult?.connections ?? [];

  const routes = useMemo<LocalhostRouteOption[]>(() => {
    const manifestRoutes = connectionResult?.connections?.find(
      (connection) => connection.id === effectiveConnectionId,
    )?.routes;
    if (manifestRoutes && manifestRoutes.length > 0) {
      return manifestRoutes.map((route) => ({
        path: route.path,
        title: route.title,
      }));
    }
    return (fallbackPaths ?? []).map((path) => ({ path }));
  }, [connectionResult, effectiveConnectionId, fallbackPaths]);

  const filteredRoutes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return routes;
    return routes.filter(
      (route) =>
        route.path.toLowerCase().includes(query) ||
        route.title?.toLowerCase().includes(query),
    );
  }, [routes, search]);

  const customPath = normalizeCustomPath(search.trim());
  const showCustomPathOption =
    customPath.length > 0 && !routes.some((route) => route.path === customPath);

  const addScreensMutation = useActionMutation("add-localhost-screens");

  const handleAdd = (path: string) => {
    if (addScreensMutation.isPending || !effectiveConnectionId) return;
    const { width, height } = VIEWPORT_SIZES[viewport];
    addScreensMutation.mutate(
      {
        designId,
        connectionId: effectiveConnectionId,
        routes: [
          { path, width, height, x: position?.x ?? 0, y: position?.y ?? 0 },
        ],
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          toast.success(t("designEditor.addLocalhostScreen.added"));
          setSearch("");
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t("designEditor.addLocalhostScreen.addFailed"),
          );
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSearch("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>
            {t("designEditor.addLocalhostScreen.title")}
          </DialogTitle>
          <DialogDescription>
            {t("designEditor.addLocalhostScreen.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1 px-4">
          <Button
            type="button"
            size="sm"
            variant={viewport === "desktop" ? "secondary" : "ghost"}
            className="cursor-pointer gap-1.5"
            onClick={() => setViewport("desktop")}
          >
            <IconDeviceDesktop className="size-4" />
            {t("designEditor.addLocalhostScreen.viewportDesktop")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewport === "mobile" ? "secondary" : "ghost"}
            className="cursor-pointer gap-1.5"
            onClick={() => setViewport("mobile")}
          >
            <IconDeviceMobile className="size-4" />
            {t("designEditor.addLocalhostScreen.viewportMobile")}
          </Button>
        </div>
        {availableConnections.length > 1 && !connectionId ? (
          <div className="px-4 pt-2">
            <Select
              value={selectedConnectionId}
              onValueChange={setSelectedConnectionId}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue
                  placeholder={
                    "Choose local app" /* i18n-ignore design screen source placeholder */
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableConnections.map((connection) => (
                  <SelectItem
                    key={connection.id}
                    value={connection.id}
                    className="text-xs"
                  >
                    {connection.name ||
                      connection.devServerUrl ||
                      connection.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Command shouldFilter={false} className="mt-2 rounded-none border-t">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("designEditor.addLocalhostScreen.searchPlaceholder")}
          />
          <CommandList>
            {filteredRoutes.length === 0 && !showCustomPathOption ? (
              <CommandEmpty>
                {t("designEditor.addLocalhostScreen.noRoutes")}
              </CommandEmpty>
            ) : null}
            <CommandGroup>
              {filteredRoutes.map((route) => (
                <CommandItem
                  key={route.path}
                  value={route.path}
                  className="cursor-pointer"
                  onSelect={() => handleAdd(route.path)}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{route.path}</span>
                    {route.title ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {route.title}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
              {showCustomPathOption ? (
                <CommandItem
                  value={customPath}
                  className={cn(
                    "cursor-pointer",
                    filteredRoutes.length > 0 && "mt-1 border-t pt-2",
                  )}
                  onSelect={() => handleAdd(customPath)}
                >
                  <IconPlus className="size-4" />
                  {t("designEditor.addLocalhostScreen.useCustomPath", {
                    path: customPath,
                  })}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
