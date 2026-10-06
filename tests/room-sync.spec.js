import { test, expect, vi, afterEach } from 'vitest'
import { startRoomSync } from '../src/client/lib/room-sync.js'
afterEach(() => vi.useRealTimers())
test('sync never overlaps requests and discards an in-flight response after stop', async () => {
  vi.useFakeTimers()
  let finish
  const request = vi.fn(() => new Promise(resolve => { finish = resolve })), receive = vi.fn()
  const stop = startRoomSync({ request, receive, failure: vi.fn(), hidden: () => false })
  await vi.advanceTimersByTimeAsync(10000); expect(request).toHaveBeenCalledTimes(1)
  stop(); finish({ revision: 1 }); await Promise.resolve()
  expect(receive).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(10000); expect(request).toHaveBeenCalledTimes(1)
})
test('sync pauses during edits, backs off on failure and resumes normal foreground polling', async () => {
  vi.useFakeTimers()
  let paused = true
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ revision: 2 }), receive = vi.fn(), failure = vi.fn()
  const stop = startRoomSync({ request, receive, failure, paused: () => paused, hidden: () => false })
  expect(request).not.toHaveBeenCalled(); paused = false
  await vi.advanceTimersByTimeAsync(2000); expect(failure).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(3999); expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(receive).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2000); expect(receive).toHaveBeenCalledTimes(2)
  stop()
})
