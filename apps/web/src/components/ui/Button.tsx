import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-app-ink text-app-ink-fg hover:opacity-90",
  accent: "bg-app-accent text-app-accent-fg hover:opacity-90",
  secondary: "border border-app-border bg-app-surface text-app-fg hover:border-app-subtle",
  ghost: "text-app-muted hover:bg-app-sunken hover:text-app-fg",
  danger: "border border-app-border bg-app-surface text-app-danger hover:bg-app-danger-soft",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2 text-sm",
};

/** Shared class list, also used to style links that act as buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}
