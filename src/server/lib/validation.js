import { z } from 'zod'
import { isIP } from 'node:net'
import { DEFAULT_ROOM_NAME } from '../../shared/room-defaults.js'

export const deviceTypes = [
  'pc', 'server', 'router', 'switch', 'access-point', 'firewall',
  'printer', 'internet', 'generic',
]

export const deviceStatuses = ['online', 'offline', 'warning', 'unknown']
export const edgeMedia = ['ethernet', 'fiber', 'wifi', 'generic']
export const edgeStatuses = ['active', 'inactive', 'unknown']

const ipv4Octet = '(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
export const ipv4Pattern = new RegExp(`^${ipv4Octet}(\\.${ipv4Octet}){3}$`)
export const ipv6Pattern = /^[0-9a-f:]+$/i
export const macPattern = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i

export const deviceDataSchema = z.object({
  ipv4: z.string().trim().optional().or(z.literal('')),
  cidr: z.coerce.number().int().min(0).max(32).optional(),
  ipv6: z.string().trim().optional().or(z.literal('')),
  mac: z.string().trim().optional().or(z.literal('')),
  vlan: z.string().trim().max(32).optional().or(z.literal('')),
  status: z.enum(deviceStatuses).default('unknown'),
  vendor: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
}).superRefine((value, ctx) => {
  if (value.ipv4 && !ipv4Pattern.test(value.ipv4)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ipv4'], message: 'IPv4 address is invalid' })
  }
  const [ipv6Address, ipv6Prefix, ...extra] = (value.ipv6 || '').split('/')
  if (value.ipv6 && (isIP(ipv6Address) !== 6 || extra.length || (ipv6Prefix !== undefined && (!/^\d{1,3}$/.test(ipv6Prefix) || Number(ipv6Prefix) > 128)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ipv6'], message: 'IPv6 address is invalid' })
  }
  if (value.mac && !macPattern.test(value.mac)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mac'], message: 'MAC address is invalid' })
  }
  if (value.vlan && (!/^\d+$/.test(String(value.vlan)) || Number(value.vlan) < 1 || Number(value.vlan) > 4094)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vlan'], message: 'VLAN must be between 1 and 4094' })
  }
  if (value.ipv4 && value.cidr === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cidr'], message: 'CIDR is required with IPv4' })
  }
})

export const nodeSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  type: z.enum(deviceTypes),
  label: z.string().trim().min(1).max(120),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
  data: deviceDataSchema,
})

export const edgeSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  sourceNodeId: z.string().min(1).max(80),
  targetNodeId: z.string().min(1).max(80),
  label: z.string().trim().max(120).default(''),
  medium: z.enum(edgeMedia).default('ethernet'),
  bandwidth: z.string().trim().max(80).default(''),
  status: z.enum(edgeStatuses).default('unknown'),
  notes: z.string().trim().max(2000).default(''),
  sourceSide: z.enum(['left', 'right']).optional(),
  targetSide: z.enum(['left', 'right']).optional(),
}).refine((value) => value.sourceNodeId !== value.targetNodeId, {
  message: 'An edge must connect two different nodes',
})

export const roomCreateSchema = z.object({
  templateId: z.string().min(1).max(80).optional(),
  name: z.string().trim().max(100).default(DEFAULT_ROOM_NAME).transform(value => value || DEFAULT_ROOM_NAME),
  description: z.string().trim().max(500).optional().default(''),
  accessMode: z.enum(['editor', 'viewer']).default('editor'),
  displayName: z.string().trim().min(1).max(60),
})

export const roomJoinSchema = z.object({
  joinCode: z.string().trim().min(6).max(12),
  displayName: z.string().trim().min(1).max(60),
  role: z.enum(['editor', 'viewer']).default('editor'),
  recoveryKey: z.string().trim().max(80).optional().default(''),
})

export const roomPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  accessMode: z.enum(['editor', 'viewer']).optional(),
})

export function parseOrThrow(schema, input) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; '))
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }
  return parsed.data
}

export function normalizeMac(mac = '') {
  return mac.trim().toLowerCase().replaceAll('-', ':')
}

export function normalizeIpv4(ip = '') {
  return ip.trim()
}
