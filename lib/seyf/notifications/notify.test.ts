import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSmsCopy, createNotificationService } from './notify.ts'
import type { NotificationLogEntry } from './types.ts'

function createAppendLogSpy() {
  const entries: Array<Omit<NotificationLogEntry, 'id' | 'createdAt'>> = []
  return {
    entries,
    appendLog: async (entry: Omit<NotificationLogEntry, 'id' | 'createdAt'>) => {
      entries.push(entry)
      return {
        id: `log-${entries.length}`,
        createdAt: '2026-04-23T00:00:00.000Z',
        ...entry,
      }
    },
  }
}

test('buildSmsCopy keeps merchant tone for deposit_deployed', () => {
  const body = buildSmsCopy('deposit_deployed', {
    amountMxn: 1200,
    instrumentLabel: 'CETES',
  })

  assert.match(body, /Tu capital ya esta trabajando/)
  assert.match(body, /CETES/)
})

test('notifyUser retries once and succeeds on the second attempt', async () => {
  const logs = createAppendLogSpy()
  let attempts = 0
  const service = createNotificationService({
    getUserSettings: async () => ({
      userId: 'user-1',
      phoneNumber: '+525511112222',
      smsOptOut: false,
      updatedAt: '2026-04-23T00:00:00.000Z',
    }),
    appendLog: logs.appendLog,
    sendSms: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('temporary outage')
      }
      return {
        providerMessageId: 'SM123',
        status: 'queued',
      }
    },
    now: () => new Date('2026-04-23T00:00:00.000Z'),
  })

  const result = await service.notifyUser('user-1', 'advance_confirmed', {
    amountMxn: 1500,
  })

  assert.equal(result.ok, true)
  assert.equal(result.attempts, 2)
  assert.equal(attempts, 2)
  assert.equal(logs.entries.length, 2)
  assert.equal(logs.entries[0]?.status, 'failed')
  assert.equal(logs.entries[1]?.status, 'sent')
})

test('notifyUser skips delivery when SMS is opted out', async () => {
  const logs = createAppendLogSpy()
  let sent = false
  const service = createNotificationService({
    getUserSettings: async () => ({
      userId: 'user-2',
      phoneNumber: '+525533334444',
      smsOptOut: true,
      updatedAt: '2026-04-23T00:00:00.000Z',
    }),
    appendLog: logs.appendLog,
    sendSms: async () => {
      sent = true
      return { providerMessageId: 'SM-nope', status: 'queued' }
    },
  })

  const result = await service.notifyUser('user-2', 'kyc_approved', {})

  assert.equal(result.ok, false)
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'opted_out')
  assert.equal(sent, false)
  assert.equal(logs.entries[0]?.status, 'skipped')
})

test('notifyUser never throws when delivery fails twice', async () => {
  const logs = createAppendLogSpy()
  const service = createNotificationService({
    getUserSettings: async () => ({
      userId: 'user-3',
      phoneNumber: '+525566667777',
      smsOptOut: false,
      updatedAt: '2026-04-23T00:00:00.000Z',
    }),
    appendLog: logs.appendLog,
    sendSms: async () => {
      throw new Error('provider down')
    },
  })

  const result = await service.notifyUser('user-3', 'withdrawal_failed', {
    amountMxn: 700,
    reason: 'CLABE no disponible',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'delivery_failed')
  assert.equal(logs.entries.length, 2)
  assert.equal(logs.entries[0]?.status, 'failed')
  assert.equal(logs.entries[1]?.status, 'failed')
})

test('notifyUser delivers via push and logs status successfully', async () => {
  const logs = createAppendLogSpy()
  let pushSent = false
  const service = createNotificationService({
    getUserSettings: async () => ({
      userId: 'user-4',
      phoneNumber: null,
      smsOptOut: false,
      pushOptOut: false,
      fcmToken: 'token-abc-123',
      updatedAt: '2026-04-23T00:00:00.000Z',
    }),
    appendLog: logs.appendLog,
    sendPush: async () => {
      pushSent = true
      return { providerMessageId: 'FCM-msg-123' }
    },
  })

  const result = await service.notifyUser('user-4', 'kyc_approved', {})

  assert.equal(result.ok, true)
  assert.equal(result.status, 'sent')
  assert.equal(pushSent, true)
  assert.equal(logs.entries.length, 1)
  assert.equal(logs.entries[0]?.channel, 'push')
  assert.equal(logs.entries[0]?.status, 'sent')
})

test('notifyUser skips push delivery when push opt-out is true', async () => {
  const logs = createAppendLogSpy()
  let pushSent = false
  const service = createNotificationService({
    getUserSettings: async () => ({
      userId: 'user-5',
      phoneNumber: null,
      smsOptOut: false,
      pushOptOut: true,
      fcmToken: 'token-abc-123',
      updatedAt: '2026-04-23T00:00:00.000Z',
    }),
    appendLog: logs.appendLog,
    sendPush: async () => {
      pushSent = true
      return { providerMessageId: 'FCM-msg-123' }
    },
  })

  const result = await service.notifyUser('user-5', 'kyc_approved', {})

  assert.equal(result.ok, false)
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'opted_out')
  assert.equal(pushSent, false)
  assert.equal(logs.entries.length, 1)
  assert.equal(logs.entries[0]?.channel, 'push')
  assert.equal(logs.entries[0]?.status, 'skipped')
  assert.equal(logs.entries[0]?.error, 'opted_out')
})
