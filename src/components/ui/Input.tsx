import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-[12px] font-medium tracking-[1.5px] uppercase text-[var(--color-on-dark-soft)]">
          {label}
        </label>
      )}
      <input
        ref={ref}
        className={[
          "h-8 px-3 rounded-[var(--radius-md)] text-[14px]",
          "bg-[var(--color-surface-dark-elevated)] text-[var(--color-on-dark)]",
          "border border-white/[0.06] outline-none",
          "placeholder:text-[var(--color-on-dark-soft)]",
          "focus:border-[var(--color-primary)] transition-colors duration-[var(--duration-fast)]",
          error ? "border-[var(--color-error)]" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error && <span className="text-[12px] text-[var(--color-error)]">{error}</span>}
    </div>
  ),
);

Input.displayName = "Input";
