/**
 * Line icons (inherit currentColor) and the Tick, the app's one "done" mark.
 * No "use client": server and client components can both use them. Don't move
 * these into ui.tsx: a server component can't read properties of an object
 * exported from a client module (`Icon.x` arrives as undefined).
 *
 * One size (18) and one stroke (1.5) everywhere; the tab bar alone uses 24.
 */
import type { ReactNode } from "react";

export function Svg({ children, size = 18, stroke = 1.5 }: { children: ReactNode; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  chevronLeft: () => (
    <Svg>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  ),
  chevronRight: () => (
    <Svg>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  ),
  alert: () => (
    <Svg>
      <path d="M12 3.5L2.8 19.5h18.4z" />
      <path d="M12 10v4M12 17v.01" />
    </Svg>
  ),
  x: () => (
    <Svg>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  plus: () => (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  minus: () => (
    <Svg>
      <path d="M5 12h14" />
    </Svg>
  ),
  external: () => (
    <Svg>
      <path d="M7 17L17 7M9 7h8v8" />
    </Svg>
  ),
};

/**
 * The signature: one 24 px round tick means "done" everywhere (a dish eaten, a
 * habit met, the plan on target). Decorative; the surrounding control or text
 * carries the meaning for screen readers.
 */
export function Tick({ done, size = 24 }: { done: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full border-2 text-white transition-colors ${done ? "border-accent bg-accent" : "border-control"}`}
    >
      {done && (
        <Svg size={Math.round(size * 0.58)} stroke={2.5}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </Svg>
      )}
    </span>
  );
}
