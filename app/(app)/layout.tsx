import { Sidebar } from "@/components/sidebar";
import { getSidebarData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { spendUsd, capUsd, followupCount } = await getSidebarData();
  return (
    <div className="app-shell">
      <Sidebar spendUsd={spendUsd} capUsd={capUsd} followupCount={followupCount} />
      <main className="content">
        <div className="content-inner">{children}</div>
      </main>
    </div>
  );
}
