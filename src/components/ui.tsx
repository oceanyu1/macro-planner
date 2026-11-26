"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { Svg } from "./icons";

/** A submit button that dims while its form's server action runs, optionally saying what it's doing. */
export function Submit({
  className = "btn",
  children,
  pendingLabel,
  ...rest
}: ComponentProps<"button"> & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || rest.disabled} className={className} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/** A <select> that submits its form as soon as it changes. */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

const TAB_ICONS: Record<string, ReactNode> = {
  "/": (
    <Svg size={24}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  "/week": (
    <Svg size={24}>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8.5 3v4M15.5 3v4" />
    </Svg>
  ),
  "/goals": (
    <Svg size={24}>
      <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />
    </Svg>
  ),
  "/settings": (
    <Svg size={24}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  ),
};

const TABS = [
  { href: "/", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/goals", label: "Goals" },
  { href: "/settings", label: "Settings" },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** Laptop navigation (lg and up); the phone uses BottomNav instead. */
export function Sidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-10 hidden w-[260px] flex-col gap-6 px-4 py-6 lg:flex">
      <div className="flex h-9 items-center gap-2.5 px-2">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-accent text-white">
          <Svg size={16} stroke={2}>
            <circle cx="12" cy="12" r="7.5" />
            <circle cx="12" cy="12" r="2.5" />
          </Svg>
        </span>
        <span className="text-[17px] font-semibold">Macros</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {TABS.map((t) => {
          const active = isActive(path, t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-9 items-center gap-2.5 rounded-lg px-2 text-[15px] transition-colors [&_svg]:size-[18px] ${active ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)] [&_svg]:text-accent" : "text-secondary hover:bg-card/60 [&_svg]:text-muted"}`}
              >
                {TAB_ICONS[t.href]}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-[#d1d1d6] bg-[#f9f9f9]/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4 px-2 pt-2">
        {TABS.map((t) => {
          const active = isActive(path, t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                {TAB_ICONS[t.href]}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Activity-style progress ring. `pct` 0–100. Decorative: put the number in text beside or inside it. */
export function Ring({ pct, size = 128, stroke = 12, children }: { pct: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-line" strokeWidth={stroke} />
        {p > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            className="stroke-accent"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${((c * p) / 100).toFixed(1)} ${c.toFixed(1)}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** A slim labelled progress bar. `fill` is a Tailwind bg class (bg-fill-green, …). */
export function Bar({
  label,
  value,
  of,
  pct,
  fill,
  valueClass = "",
}: {
  label: string;
  value: ReactNode;
  of: ReactNode;
  pct: number;
  fill: string;
  valueClass?: string;
}) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-[15px] leading-5">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">
          <span className={`font-medium ${valueClass || "text-foreground"}`}>{value}</span> {of}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
