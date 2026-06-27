import { headers } from "next/headers";
import DashboardClient from '@/components/app/dashboard-client'
import { buildDashboardViewModel } from '@/lib/seyf/dashboard-view-model'

/** Cookies + Etherfuse + ledger: no cachear como estático. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const headersList = await headers();
  const userId = headersList.get("x-user-id");
  const vm = await buildDashboardViewModel({ userId })

  return <DashboardClient vm={vm} />
}
