import { headers } from "next/headers";
import AppTopBar from '@/components/app/app-top-bar'
import { AppMobileHistorySeed } from '@/components/app/app-mobile-history-seed'
import BottomNav from '@/components/app/bottom-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const status = headersList.get("x-user-status");

  return (
    <div className="relative min-h-screen bg-background text-foreground antialiased">
      <AppMobileHistorySeed />
      {status === "pending_kyc" && (
        <div className="relative overflow-hidden bg-gradient-to-r from-amber-500/20 via-amber-600/25 to-amber-500/20 border-b border-amber-500/20 px-4 py-3 text-center text-sm font-medium text-amber-200 select-none backdrop-blur-md">
          <div className="flex items-center justify-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <span>Tu verificación de identidad (KYC) está pendiente. Podrás realizar depósitos una vez aprobada.</span>
          </div>
        </div>
      )}
      <AppTopBar />
      <main className="pb-28">{children}</main>
      <BottomNav />
    </div>
  )
}
