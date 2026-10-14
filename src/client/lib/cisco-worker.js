import { createCiscoLab } from './cisco-lab.js'
let lab
self.onmessage = ({data}) => {
  try {
    if (data.action === 'init') { lab = createCiscoLab(data.graph); self.postMessage({id:data.id,ready:true,prompts:Object.fromEntries(data.graph.nodes.map(n=>[n.id,lab.prompt(n.id)]))}); return }
    if (!lab) throw new Error('Cisco Lab ยังไม่พร้อม')
    if (data.action === 'saved') { lab.saved(data.nodeId); self.postMessage({id:data.id}); return }
    const result = data.action === 'complete' ? {completions:lab.complete(data.nodeId,data.input)} : lab.run(data.nodeId,data.input,data.writable)
    self.postMessage({id:data.id,...result})
  } catch (error) { self.postMessage({id:data.id,error:error.message}) }
}
