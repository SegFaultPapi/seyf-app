import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/seyf/api-error'
import { resolveEtherfuseRampContext } from '@/lib/seyf/etherfuse-ramp-context'
import { fetchUserMovements } from '@/lib/seyf/user-movements'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: Request) {
  try {
    const wallet = new URL(req.url).searchParams.get('wallet')?.trim() ?? ''
    const walletHint = wallet.length > 0 ? wallet : null
    const ctx = await resolveEtherfuseRampContext({ walletPublicKeyHint: walletHint })
    const movements = await fetchUserMovements(ctx, { walletPublicKey: walletHint })
    
    // Buscar el retiro más reciente
    const withdraw = movements.find((m) => m.tipo === 'retiro')
    
    return NextResponse.json({
      status: withdraw?.estado || 'none',
      movement: withdraw || null,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (e) {
    return toErrorResponse(e, 'withdraw-status')
  }
}
