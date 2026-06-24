import { NextResponse, type NextRequest } from "next/server"
import { getWalletForClabe } from "@/lib/bitso/clabe-store"
import { logger } from "@/lib/observability/logger"
import { withLogging } from "@/lib/observability/with-logging"

/**
 * POST /api/webhooks/bitso
 *
 * Recibe eventos de Juno/Bitso (depósitos SPEI confirmados, etc.).
 * Usa el índice inverso KV para identificar a qué wallet Stellar acreditar.
 *
 * Registrar esta URL en el dashboard de Juno:
 *   https://TU-DOMINIO/api/webhooks/bitso
 */

type JunoWebhookEvent = {
  event: string
  data?: {
    clabe?: string
    amount?: string | number
    status?: string
    transaction_id?: string
    [key: string]: unknown
  }
}

async function handlePost(request: NextRequest, _context: { params: Promise<Record<string, string | string[]>> }) {
  const body = (await request.json()) as JunoWebhookEvent

  logger.info({ route: "webhooks/bitso", event: body.event }, `Bitso webhook event: ${body.event}`)

  if (body.event === "deposit.confirmed" || body.event === "SPEI_DEPOSIT") {
    const clabe = body.data?.clabe
    const amount = body.data?.amount
    const txId = body.data?.transaction_id

    if (!clabe) {
      logger.warn({ route: "webhooks/bitso" }, "Evento sin CLABE")
      return NextResponse.json({ received: true })
    }

    const stellarAddress = await getWalletForClabe(clabe)

    if (!stellarAddress) {
      logger.warn({ route: "webhooks/bitso", clabe: clabe.slice(0, 6) + "..." }, "CLABE sin wallet asociada")
      return NextResponse.json({ received: true })
    }

    logger.info(
      { route: "webhooks/bitso/deposit", amount, wallet: stellarAddress.slice(0, 6) + "...", txId },
      `Dep\u00f3sito ${amount} MXN para wallet ${stellarAddress.slice(0, 6)}... (tx: ${txId})`,
    )
  }

  return NextResponse.json({ received: true })
}

export const POST = withLogging(handlePost, { routeName: "webhooks/bitso", provider: "bitso" })
