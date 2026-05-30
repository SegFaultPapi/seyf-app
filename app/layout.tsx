import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { ThemeProvider } from '@/components/theme-provider'
import { PublicMobileHistorySeed } from '@/components/app/public-mobile-history-seed'
import PollarProviderClient from '@/components/providers/pollar-provider-client'
import { InstallPrompt } from '@/components/app/install-prompt'
import { ServiceWorkerRegistration } from '@/components/app/service-worker-registration'
import { getSiteUrl } from '@/app/site-config'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
})
const _geistMono = Geist_Mono({ subsets: ["latin"] });

const siteUrl = getSiteUrl()
const defaultTitle = 'Seyf — Gasta ahora y nunca pagues'
const defaultDescription =
  'Bonos, liquidez y tarjeta en pesos mexicanos. Adelanta rendimientos, protege tu capital y opera con custodia Stellar vía Pollar.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: '%s · Seyf',
  },
  description: defaultDescription,
  applicationName: 'Seyf',
  keywords: ['Seyf', 'bonos', 'CETES', 'México', 'ahorro', 'liquidez', 'Stellar', 'Pollar'],
  authors: [{ name: 'Seyf' }],
  creator: 'Seyf',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: siteUrl,
    siteName: 'Seyf',
    title: defaultTitle,
    description: defaultDescription,
    images: [
      {
        url: '/og.png',
        width: 1536,
        height: 1024,
        alt: 'Seyf — bonos y liquidez en pesos mexicanos',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: defaultTitle,
    description: defaultDescription,
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'Seyf' }],
  },
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0d3531' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const messages = await getMessages()
  return (
    <html lang="es-MX" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* iOS PWA */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Seyf" />
        <link rel="apple-touch-icon" href="/SEYF.png" />
        {/* iOS splash screens — portrait only, covers common device sizes */}
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" href="/splashes/splash-1290x2796.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" href="/splashes/splash-1179x2556.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" href="/splashes/splash-1170x2532.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" href="/splashes/splash-1125x2436.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" href="/splashes/splash-828x1792.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" href="/splashes/splash-750x1334.png" />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NextIntlClientProvider messages={messages}>
            <PublicMobileHistorySeed />
            <PollarProviderClient>{children}</PollarProviderClient>
          </NextIntlClientProvider>
        </ThemeProvider>
        <InstallPrompt />
        <ServiceWorkerRegistration />
        <Analytics />
      </body>
    </html>
  )
}
