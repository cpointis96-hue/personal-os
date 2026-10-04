import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-active)] active:scale-[0.98]",
  ghost:
    "bg-transparent text-[var(--color-on-dark-soft)] hover:text-[var(--color-on-dark)] hover:bg-white/5 active:scale-[0.98]",
  danger:
    "bg-transparent text-[var(--color-error)] hover:bg-[var(--color-error)]/10 active:scale-[0.98]",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-3 text-[13px]",
  md: "h-8 px-4 text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] font-medium",
        "transition-all duration-[var(--duration-fast)] ease-out",
        "disabled:opacity-40 disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className,
      ].join(" ")}
      {...props}
    />
  ),
);

Button.displayName = "Button";
