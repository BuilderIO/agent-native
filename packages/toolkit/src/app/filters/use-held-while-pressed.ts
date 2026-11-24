import { useEffect, useReducer, useRef } from "react";

export function useHeldWhilePressed<T>(value: T): T {
  const [, release] = useReducer((count: number) => count + 1, 0);
  const pressed = useRef(false);
  const held = useRef(value);
  if (!pressed.current) held.current = value;

  useEffect(() => {
    const press = () => {
      pressed.current = true;
    };
    const lift = () => {
      if (!pressed.current) return;
      pressed.current = false;
      release();
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", lift, true);
    document.addEventListener("pointercancel", lift, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", lift, true);
      document.removeEventListener("pointercancel", lift, true);
    };
  }, []);

  return held.current;
}
