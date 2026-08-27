import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

interface SelectOption<T> {
  label: string;
  value: T;
}

interface SelectProps<T extends string> {
  id?: string;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
}

export function Select<T extends string>({
  id,
  options,
  value,
  onChange,
  placeholder,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const listboxId = useId();

  const visibleOptions = options;
  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setFlipUp(window.innerHeight - rect.bottom < 180);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function close(e: MouseEvent | TouchEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, visibleOptions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (focusedIndex >= 0 && visibleOptions[focusedIndex]) {
          onChange(visibleOptions[focusedIndex].value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }

    function handleResize() {
      setOpen(false);
    }

    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleResize);
    };
  }, [open, focusedIndex, visibleOptions, onChange]);

  useEffect(() => {
    if (open && focusedIndex >= 0) {
      optionRefs.current[focusedIndex]?.focus({ preventScroll: true });
    }
  }, [focusedIndex, open]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          setOpen((o) => !o);
          setFocusedIndex(options.findIndex((o) => o.value === value));
        }}
        className="inline-flex min-w-40 cursor-pointer items-center justify-between gap-2 rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-[var(--b-bg-raised)] px-3 py-2 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] text-[var(--b-text-primary)] transition-[border-color,background] duration-150 hover:bg-[var(--c-neutral-800)]"
      >
        {selected?.label ?? placeholder ?? "Select..."}
        <IconChevronDown
          size={16}
          className={`transition-transform duration-150 ${open ? "rotate-180" : "rotate-0"}`}
        />
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={listboxId}
          role="listbox"
          className={[
            "absolute left-0 z-20 m-0 min-w-full list-none rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-prominent)] p-1",
            flipUp ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
          ].join(" ")}
        >
          {visibleOptions.map((option, i) => (
            <li
              key={option.value}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={`cursor-pointer rounded-[var(--b-radius-sm)] px-[10px] py-2 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] text-[var(--b-text-primary)] transition-[background,color] duration-100 hover:bg-white/8 ${
                i === focusedIndex
                  ? "bg-[var(--b-bg-raised)]"
                  : "bg-transparent"
              }`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
