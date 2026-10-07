import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RoomVoice from '../src/client/RoomVoice.vue'

let wrapper, track, pcs, send
beforeEach(() => {
  pcs = []; track = { enabled: true, stop: vi.fn() }
  const media = { getTracks: () => [track], getAudioTracks: () => [track] }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(media) } })
  vi.stubGlobal('Audio', class { play = vi.fn().mockResolvedValue(); pause = vi.fn() })
  vi.stubGlobal('RTCPeerConnection', class {
    constructor() { pcs.push(this) }
    addTrack = vi.fn(); close = vi.fn(); addIceCandidate = vi.fn()
    createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer-sdp' })
    createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'answer-sdp' })
    setLocalDescription = vi.fn(async value => { this.localDescription = value })
    setRemoteDescription = vi.fn(async value => { this.remoteDescription = value })
  })
  send = vi.fn().mockResolvedValue({})
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
async function join(id, peers = []) {
  wrapper = mount(RoomVoice, { props: { participant: { id }, connectionState: 'connected', send, state: { voice: [{ id, displayName: 'You' }, ...peers.map(id => ({ id, displayName: id }))], signals: [] } } })
  await wrapper.find('button').trigger('click'); await flushPromises()
}
it('joins, creates one offer, mutes and releases tracks and connections when leaving', async () => {
  await join('a', ['b'])
  expect(send).toHaveBeenCalledWith({ action: 'voice-join' })
  expect(send).toHaveBeenCalledWith({ action: 'voice-signal', target: 'b', kind: 'offer', sdp: 'offer-sdp' })
  expect(pcs).toHaveLength(1)
  await wrapper.findAll('button').find(b => b.text() === 'ปิดไมค์').trigger('click')
  expect(track.enabled).toBe(false)
  await wrapper.findAll('button').find(b => b.text() === 'ออกจาก Voice').trigger('click'); await flushPromises()
  expect(track.stop).toHaveBeenCalledOnce(); expect(pcs[0].close).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith({ action: 'voice-leave' })
})
it('buffers early ICE candidates, answers an offer once, and removes departed peers', async () => {
  await join('z', ['a'])
  expect(pcs[0].createOffer).not.toHaveBeenCalled()
  const voice = [{ id: 'z', displayName: 'You' }, { id: 'a', displayName: 'a' }]
  const signals = [{ id: 1, from: 'a', kind: 'candidate', candidate: { candidate: 'ice' } }, { id: 2, from: 'a', kind: 'offer', sdp: 'offer-sdp' }]
  await wrapper.setProps({ state: { voice, signals } }); await flushPromises()
  expect(pcs[0].addIceCandidate).toHaveBeenCalledWith({ candidate: 'ice' })
  expect(send).toHaveBeenCalledWith({ action: 'voice-signal', target: 'a', kind: 'answer', sdp: 'answer-sdp' })
  await wrapper.setProps({ state: { voice, signals: [...signals] } }); await flushPromises()
  expect(pcs[0].createAnswer).toHaveBeenCalledOnce()
  await wrapper.setProps({ state: { voice: [voice[0]], signals: [] } }); await flushPromises()
  expect(pcs[0].close).toHaveBeenCalledOnce()
})
it('stops a microphone granted after the component has been unmounted', async () => {
  let grant
  navigator.mediaDevices.getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve }))
  wrapper = mount(RoomVoice, { props: { participant: { id: 'a' }, connectionState: 'connected', send, state: { voice: [], signals: [] } } })
  await wrapper.find('button').trigger('click'); wrapper.unmount(); wrapper = null
  grant({ getTracks: () => [track] }); await flushPromises()
  expect(track.stop).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled()
})
