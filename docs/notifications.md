# Notification System Developer Guide (SMS & FCM Push)

This document describes the architecture of the notification system in Seyf (SMS via Twilio and Web Push via Firebase Cloud Messaging) and details how to test the system in both Mock/Simulation and Real End-to-End modes.

---

## 1. Architecture Overview

Seyf handles notifications across two primary channels:
- **SMS (`sms`)**: Dispatched via Twilio (utilizing messaging services or direct numbers).
- **Web Push (`push`)**: Dispatched via Firebase Cloud Messaging (FCM) using the direct **FCM v1 REST API** (avoiding heavy backend dependencies) and a registered Service Worker.

### User Preferences
Preferences are stored per-user in `data/seyf-notification-settings.json` (for local development/MVP) and exposed via `/api/seyf/notification-settings`.
- `smsEnabled` / `smsOptOut`: Enables/disables SMS messages.
- `pushEnabled` / `pushOptOut`: Enables/disables Web Push messages.
- `fcmToken`: The browser-registered FCM token used to target the push notification to a specific device.

---

## 2. Testing Scenarios

The notification system dynamically checks for credentials. If environment variables are missing, it falls back gracefully to a simulation mode.

### Option A: Mock/Simulation Mode (Default Local Dev)
This is the default mode for local development. It does not require real Twilio or Firebase credentials.

- **Client Behavior**: When the user toggles **"Notificaciones Push"** ON in the settings card, the client-side helper (`lib/seyf/notifications/fcm-web.ts`) detects that Firebase environment variables are empty and registers a mock token: `mock-fcm-token-<timestamp>`.
- **Server Behavior**: When sending a push, the server (`lib/seyf/notifications/notify.ts`) detects that the service account configuration (`FIREBASE_SERVICE_ACCOUNT_JSON`) is missing. Instead of calling Firebase, it logs the simulated notification to the terminal.
- **Persistence**: User preferences and the mock token are saved to `data/seyf-notification-settings.json`.

#### Verification Steps:
1. Start the dev server: `pnpm dev`.
2. Navigate to the settings page in your browser.
3. Toggle the **"Notificaciones Push"** switch to **ON**.
4. Click **"Guardar"**. You will see the green success banner.
5. Open `data/seyf-notification-settings.json`. Confirm that the entry contains:
   ```json
   "pushOptOut": false,
   "fcmToken": "mock-fcm-token-..."
   ```
6. Run the notification test suite or trigger a notification event:
   ```bash
   pnpm test:notifications
   ```
7. Verify in your terminal logs that the simulated push was sent:
   ```text
   [fcm-web-stub] Sending push to mock-fcm-token-...: [Title] - [Body]
   ```
8. Toggle the switch to **OFF**, click **"Guardar"**, and run the test suite again. Verify in the logs that the push was skipped:
   ```text
   [notifyUser] Skipping push channel for user: missing_push_token or opt_out
   ```

---

### Option B: Real Firebase Project (End-to-End Mode)
This mode connects the app to a real Firebase Cloud Messaging project for live browser push notifications.

#### Configuration:
Add the following keys to your `.env.local` file:

```env
# Client-Side Configuration (Firebase Console -> Project Settings)
NEXT_PUBLIC_FIREBASE_API_KEY="your-api-key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your-project-id.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="your-project-id"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="your-project-id.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
NEXT_PUBLIC_FIREBASE_APP_ID="your-app-id"

# VAPID Key (Firebase Console -> Cloud Messaging -> Web configuration -> Web Push certificates)
NEXT_PUBLIC_FIREBASE_VAPID_KEY="your-public-vapid-key"

# Server-Side Service Account JSON (Firebase Console -> Project Settings -> Service Accounts -> Generate new private key)
# Paste the entire JSON as a single-line string
FIREBASE_SERVICE_ACCOUNT_JSON='{"type": "service_account", "project_id": "...", "private_key": "...", "client_email": "..."}'
```

#### Verification Steps:
1. Restart the dev server (`pnpm dev`) to load the new environment variables.
2. Open the settings page.
3. Toggle the **"Notificaciones Push"** switch to **ON**.
4. The browser will prompt you for notification permissions. Click **Allow**.
5. Click **"Guardar"** to persist your real FCM token.
6. Open `data/seyf-notification-settings.json` and copy the generated `fcmToken`.
7. Go to your **Firebase Console -> Cloud Messaging**.
8. Create a test notification campaign, select **"Send test message"**, paste your copied `fcmToken`, and click **Test**.
9. **Verify Foreground/Background Delivery**:
   - **Foreground**: Verify that the browser handles the incoming notification.
   - **Background**: Close the Seyf tab, send a test push, and verify that the operating system displays a native notification banner.
   - **Click Action**: Click the notification banner. Verify that it focuses the app and redirects you to the `/dashboard`.
10. **Verify Opt-Out**:
    - Turn the switch **OFF** and click **"Guardar"**.
    - Send another test push from the Firebase console and verify that no notification is shown.
