import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyEtherfuseApiKey } from '@/lib/etherfuse/client'
import { getEtherfuseConfig } from '@/lib/etherfuse/config'
import { withLogging } from '@/lib/observability/with-logging'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/seyf/internal/etherfuse-health
 * Llama a /ramp/me para verificar que ETHERFUSE_API_KEY y ETHERFUSE_API_BASE_URL son correctos.
 * Útil para diagnosticar "Organization not found" en Vercel.
 */
async function handleGet(_request: NextRequest, _context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const { baseUrl, apiKey } = getEtherfuseConfig()
    const keyPreview = apiKey.length > 12
      ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
      : '(muy corta)'

    const result = await verifyEtherfuseApiKey()

    return NextResponse.json({
      ok: true,
      baseUrl,
      keyPreview,
      organization: result.organization,
    })
  } catch (e) {
    const { baseUrl, apiKey } = (() => {
      try { return getEtherfuseConfig() } catch { return { baseUrl: '?', apiKey: '' } }
    })()
    const keyPreview = apiKey.length > 12
      ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
      : apiKey ? '(muy corta)' : '(vacía)'

    return NextResponse.json(
      {
        ok: false,
        baseUrl,
        keyPreview,
        error: e instanceof Error ? e.message : String(e),
        hint: 'Verifica ETHERFUSE_API_KEY y ETHERFUSE_API_BASE_URL en Vercel → Settings → Environment Variables.',
      },
      { status: 500 },
    )
  }
}

export const GET = withLogging(handleGet, { routeName: "internal/etherfuse-health", provider: "etherfuse" })
