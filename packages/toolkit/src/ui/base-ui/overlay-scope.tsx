import type { Dialog } from "@base-ui/react/dialog";
import * as React from "react";

type PortalTarget = Dialog.Portal.Props["container"];
const TargetContext = React.createContext<PortalTarget>(undefined);

/** Gives overlays a mount point inside a themed region. An explicit popup container takes precedence.
 * @import import { OverlayScope } from "@agent-native/toolkit/ui/base-ui/overlay-scope";
 */
export function OverlayScope({
  container,
  children,
}: {
  container: PortalTarget;
  children: React.ReactNode;
}) {
  return (
    <TargetContext.Provider value={container}>
      {children}
    </TargetContext.Provider>
  );
}

export function scopePortal(
  Portal: React.ComponentType<
    Dialog.Portal.Props & React.RefAttributes<HTMLDivElement>
  >,
) {
  const ScopedPortal = React.forwardRef<HTMLDivElement, Dialog.Portal.Props>(
    ({ container, children, ...props }, ref) => {
      const scoped = React.useContext(TargetContext);
      const target = container === undefined ? scoped : container;
      const targetRef = target && "current" in target ? target : null;
      const [committedRef, setCommittedRef] =
        React.useState<typeof targetRef>(null);
      React.useEffect(() => {
        if (targetRef !== committedRef) setCommittedRef(targetRef);
      }, [targetRef, committedRef]);
      const resolved = targetRef && targetRef !== committedRef ? null : target;
      return (
        <Portal {...props} ref={ref} container={resolved}>
          <TargetContext.Provider value={undefined}>
            {children}
          </TargetContext.Provider>
        </Portal>
      );
    },
  );
  ScopedPortal.displayName = Portal.displayName ?? "ScopedPortal";
  return ScopedPortal;
}
