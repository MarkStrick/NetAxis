import { z } from 'zod'
import { nodeSchema, edgeSchema, parseOrThrow } from './validation.js'
import { planSchema } from './planning.js'

const identifier = z.string().min(1).max(80)
const templateSchema = z.object({
  id: identifier, name: z.string().max(160), useCase: z.string().max(1000),
  checklist: z.array(z.string().max(1000)).max(30), mode: z.enum(['Realtime', 'Simulation']),
  scenarios: z.array(z.object({
    id: identifier, name: z.string().max(200), source: identifier, target: identifier,
    protocol: z.enum(['ICMP', 'ARP', 'TCP', 'UDP']), ttl: z.number().int().min(1).max(255),
    destinationPort: z.number().int().min(1).max(65535), payloadBytes: z.number().int().min(0).max(1400),
    expected: z.enum(['success', 'failed']), note: z.string().max(1000).optional(),
    disabledEdges: z.array(identifier).max(1000).default([]), enabledEdges: z.array(identifier).max(1000).default([]),
  })).max(100),
})
const workspaceSchema = z.object({
  format: z.literal('netaxis-workspace'), version: z.literal(1),
  room: z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(500).default(''), accessMode: z.enum(['editor', 'viewer']).default('editor') }),
  nodes: z.array(nodeSchema).max(500), edges: z.array(edgeSchema).max(1000),
  plan: planSchema.nullable(), template: templateSchema.nullable(),
}).superRefine((value, ctx) => {
  const nodeIds = new Set(value.nodes.map(n => n.id)), edgeIds = new Set(value.edges.map(e => e.id))
  const ips = value.nodes.map(n => n.data.ipv4).filter(Boolean)
  if (value.nodes.some(n => !n.id) || value.edges.some(e => !e.id) || nodeIds.size !== value.nodes.length || edgeIds.size !== value.edges.length) ctx.addIssue({ code: 'custom', message: 'Every device and link must have a unique ID' })
  if (new Set(ips).size !== ips.length || value.edges.some(e => !nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId))) ctx.addIssue({ code: 'custom', message: 'Duplicate IPv4 or missing link endpoint' })
})
export const parseWorkspace = input => parseOrThrow(workspaceSchema, input)
