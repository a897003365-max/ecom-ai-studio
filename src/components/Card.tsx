import type { ReactNode } from "react";
import { clsx } from "../utils/format";

interface CardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ title, action, children, className, hover = false }: CardProps) {
  return (
    <section className={clsx("card", hover && "card-hover", className)}>
      {(title || action) && (
        <div className="section-title">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
