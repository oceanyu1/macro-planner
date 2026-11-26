import { BottomNav, Sidebar } from "@/components/ui";

/**
 * Phone: one narrow column with the bottom tab bar.
 * Laptop (lg, ≥1024 px): a fixed sidebar on the left and a wide content area.
 * Pages that read better narrow (Week, Goals, Settings) cap themselves at lg:max-w-2xl.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Sidebar />
      <main className="mx-auto max-w-xl px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-28 lg:mr-0 lg:ml-[260px] lg:max-w-[1260px] lg:px-10 lg:pt-9 lg:pb-14">
        {children}
      </main>
      <BottomNav />
    </>
  );
}
