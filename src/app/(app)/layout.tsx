import { BottomNav } from "@/components/ui";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="mx-auto max-w-xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">{children}</main>
      <BottomNav />
    </>
  );
}
