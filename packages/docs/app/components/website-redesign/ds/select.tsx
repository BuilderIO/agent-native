import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

interface SelectOption<T> {
  label: string;
  value: T;
}

interface SelectProps<T extends string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
}

export function Select<T extends string>({ options, value, onChange, placeholder }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const listboxId = useId();

  const visibleOptions = options;
  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

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
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          setOpen((o) => !o);
          setFocusedIndex(options.findIndex((o) => o.value === value));
        }}
        className="bg-[var(--b-bg-raised)] transition-[border-color,background] duration-150 hover:bg-[var(--c-neutral-800)]"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 160,
          fontFamily: "var(--b-font-sans)",
          fontSize: "var(--b-t-paragraph-2)",
          color: "var(--b-text-primary)",
          border: "1px solid var(--b-action-secondary-border)",
          borderRadius: "var(--b-radius)",
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        {selected?.label ?? placeholder ?? "Select..."}
        <IconChevronDown
          size={16}
          className="transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            left: 0,
            [flipUp ? "bottom" : "top"]: "calc(100% + 4px)",
            minWidth: "100%",
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "var(--b-bg-prominent)",
            border: "1px solid var(--b-border-default)",
            borderRadius: "var(--b-radius)",
            zIndex: 20,
          }}
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
              className={`transition-[background,color] duration-100 hover:bg-white/8 ${
                i === focusedIndex ? "bg-[var(--b-bg-raised)]" : "bg-transparent"
              }`}
              style={{
                padding: "8px 10px",
                borderRadius: "var(--b-radius-sm)",
                fontFamily: "var(--b-font-sans)",
                fontSize: "var(--b-t-paragraph-2)",
                color: "var(--b-text-primary)",
                cursor: "pointer",
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
