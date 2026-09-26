
interface QueuedUpdate {
  fiber: any;
  queue: any;
  update: any;
}

let frozen = false;
let originalDispatcher: any = null;
let queuedUpdates: QueuedUpdate[] = [];

function getInternals(): any {
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return null;

  const renderers = hook.renderers;
  if (!renderers || renderers.size === 0) return null;

  const renderer = renderers.values().next().value;
  return renderer?.currentDispatcherRef || null;
}

export function freezeReact(): () => void {
  if (frozen) return () => {};

  const internals = getInternals();
  if (!internals) return () => {};

  frozen = true;
  originalDispatcher = internals.current;
  queuedUpdates = [];

  const proxyDispatcher = new Proxy(originalDispatcher, {
    get(target, prop) {
      if (prop === "useState" || prop === "useReducer") {
        return (...args: any[]) => {
          const result = target[prop](...args);
          if (Array.isArray(result) && typeof result[1] === "function") {
            const originalSetter = result[1];
            result[1] = (action: any) => {
              queuedUpdates.push({
                fiber: null,
                queue: null,
                update: { setter: originalSetter, action },
              });
            };
          }
          return result;
        };
      }
      return target[prop];
    },
  });

  internals.current = proxyDispatcher;

  return () => {
    if (!frozen) return;
    frozen = false;

    if (internals && originalDispatcher) {
      internals.current = originalDispatcher;
    }

    for (const { update } of queuedUpdates) {
      try {
        update.setter(update.action);
      } catch {
        // Update may no longer be valid
      }
    }

    queuedUpdates = [];
    originalDispatcher = null;
  };
}

export function isReactFrozen(): boolean {
  return frozen;
}
