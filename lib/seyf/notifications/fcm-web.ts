import { initializeApp, getApps } from 'firebase/app'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

/**
 * Checks if FCM public configuration keys are present.
 */
export function isFcmConfigured(): boolean {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId &&
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  )
}

/**
 * Requests native browser notification permissions.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'default'
  }
  return Notification.requestPermission()
}

/**
 * Registers/Retrieves the FCM registration token for the client browser.
 * Falls back to mock token in local/dev if Firebase variables are not set.
 */
export async function getFcmToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null

  if (!isFcmConfigured()) {
    console.warn('[FCM] Firebase environment variables not set. Falling back to mock token.')
    return 'mock-fcm-token-' + Math.random().toString(36).substring(2, 15)
  }

  try {
    const supported = await isSupported()
    if (!supported) {
      console.warn('[FCM] Push notifications are not supported in this browser.')
      return null
    }

    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
    const messaging = getMessaging(app)

    // Ensure service worker is fully loaded and active
    const registration = await navigator.serviceWorker.ready

    const token = await getToken(messaging, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    })

    return token
  } catch (err) {
    console.error('[FCM] Error obtaining FCM token:', err)
    return null
  }
}
