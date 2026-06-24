import { NextResponse } from 'next/server'
import { z } from 'zod'
import { deployCapital } from '@/lib/seyf/capital-deploy'
import { toErrorResponse } from '@/lib/seyf/api-error'

const bodySchema = z.object({
  userId: z.string().min(1),
  amountMxn: z.number().int().positive().max(10_000_000),
  cycleId: z.string().min(1),
})

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await deployCapital(parsed.data)
    return NextResponse.json({
      ok: true,
      onrampOrderId: result.onrampOrderId,
      onrampTxHash: result.onrampTxHash,
      stablebondOrderId: result.stablebondOrder.orderId,
      stablebondTxHash: result.stablebondOrder.confirmedTxSignature,
      stablebondStatus: result.stablebondOrder.status,
      mxneAmount: result.mxneAmount,
      rateSnapshot: result.rateSnapshot,
    })
  } catch (e) {
    return toErrorResponse(e, 'deploy')
  }
}
