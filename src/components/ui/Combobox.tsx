import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function Combobox({ options, value, onChange, placeholder = "Sélectionner...", label }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      {label && (
        <label className="text-[12px] font-medium tracking-[1.5px] uppercase text-[var(--color-on-dark-soft)]">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "h-8 px-3 flex items-center justify-between gap-2 rounded-[var(--radius-md)]",
          "bg-[var(--color-surface-dark-elevated)] text-[14px]",
          "border transition-colors duration-[var(--duration-fast)]",
          open ? "border-[var(--color-primary)]" : "border-white/[0.06]",
          selected ? "text-[var(--color-on-dark)]" : "text-[var(--color-on-dark-soft)]",
        ].join(" ")}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`shrink-0 text-[var(--color-on-dark-soft)] transition-transform duration-[var(--duration-fast)] ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul className="absolute top-full mt-1 w-full z-50 rounded-[var(--radius-md)] bg-[var(--color-surface-dark-elevated)] border border-white/[0.06] overflow-hidden shadow-xl">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 h-8 text-[14px] text-left hover:bg-white/5 transition-colors duration-[var(--duration-fast)]"
              >
                <Check
                  size={14}
                  strokeWidth={1.5}
                  className={`shrink-0 text-[var(--color-primary)] ${opt.value === value ? "opacity-100" : "opacity-0"}`}
                />
                <span className={opt.value === value ? "text-[var(--color-on-dark)]" : "text-[var(--color-on-dark-soft)]"}>
                  {opt.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
