import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { instantiateTemplate } from '../src/shared/templates.js'
import { parseWorkspace } from '../src/server/lib/workspace-schema.js'
import { validateNetwork } from '../src/shared/network.js'
import { labRecipes } from './labs/recipes.js'
import { createCiscoLab } from '../src/client/lib/cisco-lab.js'
import { buildCiscoPdu } from '../src/shared/simulator.js'
import { nodeSchema, edgeSchema } from '../src/server/lib/validation.js'
import { calculatePlan, planSchema } from '../src/server/lib/planning.js'
export function compileLabs() {
 return labRecipes.map(recipe=>{
  const lab=structuredClone(recipe),engine=createCiscoLab(lab)
  for(const [id,commands] of Object.entries(lab.commands)) for(const input of commands) {
   const result=engine.run(id,input);assert.ok(!/^%|Invalid input|Unknown command|Error:/i.test(result.output),`${lab.id} ${id}: ${input}: ${result.output}`)
  }
  lab.nodes=lab.nodes.map(n=>lab.commands[n.id]?engine.changes(n.id):n)
  lab.plan.assignments=lab.nodes.filter(n=>n.data.ipv4).flatMap(n=>{const segment=lab.plan.segments.find(s=>n.data.ipv4.startsWith(s.cidr.split('.').slice(0,3).join('.')+'.'));return segment&&n.data.ipv4!==segment.gateway?[{segmentId:segment.id,ip:n.data.ipv4,kind:n.type==='server'?'server':'device',label:n.label,mac:''}]:[]})
  assert.deepEqual(calculatePlan(planSchema.parse(lab.plan)).issues,[])
  for(const n of lab.nodes) nodeSchema.parse(n)
  for(const e of lab.edges) edgeSchema.parse(e)
  assert.deepEqual(validateNetwork(lab),[],lab.id)
  for(const s of lab.scenarios) {const graph={...lab,edges:lab.edges.map(e=>s.disabledEdges?.includes(e.id)?{...e,status:'inactive'}:e)},pdu=buildCiscoPdu(graph,s);assert.equal(pdu.outcome,s.expected,`${lab.id} ${s.id}: ${pdu.reason}`)}
  lab.meta=`${lab.nodes.length} devices · Cisco CLI configured · ${lab.scenarios.length} scenarios`;delete lab.commands;return lab
 })
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const labs=compileLabs();fs.writeFileSync('src/shared/lab-templates.json',JSON.stringify(labs,null,2)+'\n')
 fs.mkdirSync('demos',{recursive:true})
 for(const lab of labs) {
  const data=instantiateTemplate(lab,'presentation')
  const workspace=parseWorkspace({format:'netaxis-workspace',version:1,room:{name:lab.name,description:lab.description,accessMode:'editor'},nodes:data.nodes,edges:data.edges,plan:data.plan,template:data.info})
  fs.writeFileSync(`demos/${lab.id}.json`,JSON.stringify(workspace,null,2)+'\n')
  fs.writeFileSync(`demos/${lab.id}-cli.txt`,lab.nodes.filter(n=>n.data.cisco).map(n=>`! ${n.label} · ${n.data.model}\n${n.data.cisco.commands.join('\n')}`).join('\n\n')+'\n')
  if(lab.id==='cisco-branch-demo') fs.writeFileSync('promo/NETAXIS_DEMO_WORKSPACE.json',JSON.stringify(workspace,null,2)+'\n')
 }
 console.log(`Compiled ${labs.length} labs through Cisco CLI; all scenarios verified.`)
}
