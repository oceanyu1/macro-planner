"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";

/** A submit button that dims while its form's server action runs. */
export function Submit({ className = "btn", children, ...rest }: ComponentProps<"button">) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || rest.disabled} className={className} {...rest}>
      {children}
    </button>
  );
}

/** A <select> that submits its form as soon as it changes. */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

const TABS = [
  { href: "/", label: "Today", icon: "◉" },
  { href: "/week", label: "Week", icon: "▦" },
  { href: "/goals", label: "Goals", icon: "◆" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active ? "text-accent font-semibold" : "text-muted"}`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Meter({
  label,
  value,
  target,
  unit,
  kind = "reach",
  estimate = false,
  hint,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  /** reach: more is better up to target. cap: must stay under. */
  kind?: "reach" | "cap";
  estimate?: boolean;
  hint?: ReactNode;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = kind === "cap" && value > target;
  const met = kind === "reach" && value >= target;
  const bar = over ? "bg-bad" : estimate ? "bg-est" : met ? "bg-good" : "bg-accent";
  const shown = unit === "g" ? Math.round(value * 10) / 10 : Math.round(value);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={`tabular-nums ${estimate ? "text-est" : over ? "text-bad font-semibold" : ""}`}>
          {estimate && "~"}
          {shown.toLocaleString()}
          <span className="text-muted">
            {" "}
            / {kind === "cap" ? "<" : ""}
            {target.toLocaleString()} {unit}
          </span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
