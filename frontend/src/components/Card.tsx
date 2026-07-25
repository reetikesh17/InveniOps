import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly padding?: "none" | "sm" | "md";
}

const PADDING: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
};

export function Card({ children, padding = "md", className = "", ...rest }: CardProps): JSX.Element {
  return (
    <div
      className={`rounded-lg border border-border bg-surface shadow-sm ${PADDING[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
