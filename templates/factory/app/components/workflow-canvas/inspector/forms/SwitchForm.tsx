import { IconPlus, IconX } from "@tabler/icons-react";
import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { nextRouteId, routePort } from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, TextInput } from "../fields";
import { RulesEditor } from "../RulesEditor";
import type { FormProps } from "./types";

type Settings = FormProps<"switch">["settings"];

export function SwitchForm({
  settings,
  onChange,
  context,
}: FormProps<"switch">) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  const [removing, setRemoving] = useState<string | null>(null);
  const routes = settings.routes;
  const update = (index: number, patch: Partial<Settings["routes"][number]>) =>
    onChange({
      routes: routes.map((route, i) =>
        i === index ? { ...route, ...patch } : route,
      ),
    });
  const connectionsOf = (routeId: string) =>
    context.graph.edges.filter(
      (edge) =>
        edge.from.node === context.node.id &&
        edge.from.port === routePort(routeId),
    ).length;
  const remove = (routeId: string) =>
    onChange({ routes: routes.filter((route) => route.id !== routeId) });

  return (
    <div className="flex flex-col gap-4">
      {routes.map((route, index) => (
        <div key={route.id} className="flex flex-col gap-2">
          <Field
            label={s.inspector.switchRoutes.routeName}
            htmlFor={`${id}-${route.id}`}
          >
            <div className="flex items-center gap-1">
              <TextInput
                id={`${id}-${route.id}`}
                value={route.label}
                onChange={(label) => update(index, { label })}
              />
              {routes.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={s.inspector.switchRoutes.remove}
                  title={s.inspector.switchRoutes.remove}
                  onClick={() =>
                    connectionsOf(route.id) > 0
                      ? setRemoving(route.id)
                      : remove(route.id)
                  }
                >
                  <IconX />
                </Button>
              )}
            </div>
          </Field>
          <RulesEditor
            combinator={route.combinator}
            onCombinator={(combinator) => update(index, { combinator })}
            rules={route.rules}
            context={context}
            onChange={(rules) => update(index, { rules })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-start"
        disabled={routes.length >= 12}
        onClick={() => {
          const routeId = nextRouteId(routes.map((route) => route.id));
          onChange({
            routes: [
              ...routes,
              {
                id: routeId,
                label: s.inspector.switchRoutes.newLabel(routes.length + 1),
                combinator: "all",
                rules: [{ left: "item.title", op: "contains", right: "" }],
              },
            ],
          });
        }}
      >
        <IconPlus />
        {s.inspector.switchRoutes.add}
      </Button>
      <p className="text-xs text-muted-foreground">
        {s.inspector.switchRoutes.otherwise}
      </p>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {s.inspector.switchRoutes.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {s.inspector.switchRoutes.confirmBody(
                removing ? connectionsOf(removing) : 0,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {s.inspector.switchRoutes.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) remove(removing);
                setRemoving(null);
              }}
            >
              {s.inspector.switchRoutes.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
