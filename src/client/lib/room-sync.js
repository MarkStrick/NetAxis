// Short requests survive serverless instance changes. Never overlap requests or
// apply a response after leaving its room. Failed requests use bounded backoff.
export function startRoomSync({ request, receive, failure, paused = () => false, hidden = () => document.hidden, interval = 2000 }) {
  let stopped = false, timer, errors = 0
  async function tick() {
    if (stopped) return
    if (!paused()) {
      try { const value = await request(); if (stopped) return; errors = 0; receive(value) }
      catch (error) { if (stopped) return; errors++; failure(error) }
    }
    if (!stopped) timer = setTimeout(tick, Math.max(hidden() ? 10000 : interval, Math.min(30000, errors ? interval * 2 ** Math.min(errors, 4) : 0)))
  }
  tick()
  return () => { stopped = true; clearTimeout(timer) }
}
