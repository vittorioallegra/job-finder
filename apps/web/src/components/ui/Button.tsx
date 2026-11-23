import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === "primary" ? "bg-app-accent text-app-bg" : "border border-app-border text-app-fg";
  return (
    <button
      type={type}
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${className}`}
      {...rest}
    />
  );
}
