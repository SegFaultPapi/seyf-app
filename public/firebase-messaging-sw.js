/**
 * Firebase Cloud Messaging Service Worker Fallback.
 * 
 * Imports the main app service worker which contains the unified push notification handlers,
 * preventing conflicts between caching/App Shell logic and FCM.
 */
importScripts('/seyf-sw.js');
