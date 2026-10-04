import { type ButtonHTMLAttributes, forwardRef } from "react";
import { type LucideIcon } from "lucide-react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  size?: 14 | 16;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, size = 16, active = false, className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={[
        "inline-flex items-center justify-center rounded-[var(--radius-sm)]",
        "transition-all duration-[var(--duration-fast)] ease-out",
        "disabled:opacity-40 disabled:pointer-events-none",
        active
          ? "text-[var(--color-primary)]"
          : "text-[var(--color-on-dark-soft)] hover:text-[var(--color-on-dark)] hover:bg-white/5",
        size === 14 ? "w-6 h-6" : "w-7 h-7",
        className,
      ].join(" ")}
      {...props}
    >
      <Icon size={size} strokeWidth={1.5} />
    </button>
  ),
);

IconButton.displayName = "IconButton";
