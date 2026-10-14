<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { io } from "socket.io-client";
import { startRoomSync } from './lib/room-sync.js';
import {
  Box,
  Cable,
  Terminal,
  Download,
  Upload,
  Calculator,
  Play,
  Cloud,
  Monitor,
  Network,
  Printer,
  Router,
  RotateCcw,
  Server,
  Shield,
  Trash2,
  Wifi,
  Search,
  Plus,
  ArrowRight,
  ChevronLeft,
  Copy,
  X,
} from "lucide-vue-next";

import { clone, csvCell } from "./lib/topology.js";
import { calculateSubnet as subnetDetails } from "../server/lib/subnet.js";
import PlanningWorkspace from "./PlanningWorkspace.vue";
import CiscoLab from "./CiscoLab.vue";
import SimulatorPanel from "./SimulatorPanel.vue";
import AccountPanel from './AccountPanel.vue';
import RoomCommunity from './RoomCommunity.vue';
import CaptchaDialog from './CaptchaDialog.vue';
import DeviceGraphic from './DeviceGraphic.vue';
import DevicePicker from './DevicePicker.vue';
import DeviceLab from './DeviceLab.vue';
import Ipv6Planner from './Ipv6Planner.vue';
import DialogFrame from './DialogFrame.vue';
import { deviceModels, supportsCiscoCli, modelFor, portsFor, resolvedPorts, vlanColor } from '../shared/devices.js';
import { validateNetwork, linkAllows } from '../shared/network.js';
import { presetProjects, templateBounds, templateViewBox } from "../shared/templates.js";
import { roomExpired, roomTimeLeft } from "../shared/room-lifetime.js";
import { DEFAULT_ROOM_NAME } from '../shared/room-defaults.js';
const ciscoOpen = ref(false);
const deviceDraft = ref(null);
const plannerOpen = ref(false);
const plannerPanel = ref(null);
function openSimulation() { if (plannerOpen.value) plannerPanel.value?.requestClose(() => { plannerOpen.value = false; simulationOpen.value = true }); else simulationOpen.value = true; }
function togglePlanner() { if (plannerOpen.value) plannerPanel.value?.requestClose(); else plannerOpen.value = true; }
function openTopology() {
  const apply = () => { plannerOpen.value = false; if (simulationOpen.value) toggleSimulation(); };
  if (plannerOpen.value) plannerPanel.value?.requestClose(apply);
  else apply();
}

const API_BASE = import.meta.env.VITE_API_BASE || "";
const SOCKET_ORIGIN = import.meta.env.VITE_SOCKET_ORIGIN || API_BASE;
const CLOUD_MODE = import.meta.env.VITE_DEPLOYMENT_MODE === 'vercel';
// getRandomValues also works for LAN development over HTTP.
const tabId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
let stopCloudSync = null;
const api = async (path, options = {}) => {
  const { headers: optionHeaders = {}, ...requestOptions } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestOptions,
    credentials: "include",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...optionHeaders },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({ message: "Server ส่งข้อมูลไม่ถูกต้อง กรุณาลองใหม่" }));
  if (!response.ok) {
    if (body?.error === 'LOGIN_REQUIRED') clearAccount();
    if (body?.error === 'ROOM_EXPIRED' && view.value === 'editor') handleRoomExpired();
    const error = new Error(body?.message || "Request failed");
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
};

const deviceDefinitions = [
  { type: "pc", label: "PC / Laptop", icon: Monitor, tone: "cyan" },
  { type: "server", label: "Server", icon: Server, tone: "blue" },
  { type: "router", label: "Router", icon: Router, tone: "violet" },
  { type: "switch", label: "L2 / L3 Switch", icon: Network, tone: "green" },
  { type: "access-point", label: "Access Point", icon: Wifi, tone: "amber" },
  { type: "firewall", label: "Firewall", icon: Shield, tone: "red" },
  { type: "printer", label: "Printer", icon: Printer, tone: "slate" },
  { type: "internet", label: "Internet / Cloud", icon: Cloud, tone: "sky" },
  { type: "generic", label: "NAS / Phone / Camera", icon: Box, tone: "gray" },
];
const deviceByType = Object.fromEntries(
  deviceDefinitions.map((item) => [item.type, item]),
);

const view = ref(window.location.pathname === '/workspace' ? 'rooms' : 'home');
function viewPath(next) { return next === 'rooms' ? '/workspace' : next === 'templates' ? '/#templates' : next === 'editor' ? `/room/${room.value.id}` : next === 'project' ? `/project/${selectedPreset.value.id}` : '/'; }
function setView(next) {
  view.value = next;
  const path = viewPath(next);
  if (window.location.pathname + window.location.hash !== path) window.history.pushState({}, '', path);
  nextTick(() => { document.querySelector('.app-shell')?.scrollIntoView?.({ block: 'start', behavior: 'auto' }); document.getElementById('main-content')?.focus({ preventScroll: true }); });
}
function goHome() {
  closeCreationTutorial(); selectedPreset.value = null;
  if (view.value === 'editor') {
    if (plannerOpen.value) plannerPanel.value?.requestClose(() => leaveRoomNow('home'));
    else leaveRoomNow('home');
  } else setView('home');
}
function openWorkspace() { selectedPreset.value = null; setView('rooms'); }
function openTemplates() { selectedPreset.value = null; setView('templates'); }
async function focusRoomForm(kind = 'create') {
  if (!['home', 'rooms'].includes(view.value)) openWorkspace();
  await nextTick();
  const form = document.querySelector(kind === 'join' ? '.join-panel' : '.create-room-panel');
  form?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  form?.querySelector('input')?.focus({ preventScroll: true });
}
function handleRoute() {
  const path = window.location.pathname + window.location.hash;
  const apply = () => { closeCreationTutorial(); resetEditor(); room.value = null; participant.value = null; window.history.replaceState({}, '', path); if (visitorVerified.value) bootstrap(); };
  if (plannerOpen.value) { window.history.replaceState({}, '', viewPath(view.value)); plannerPanel.value?.requestClose(apply); }
  else apply();
}
const selectedPreset = ref(null);
const roomTemplate = ref(null);
const demoOpen = ref(false), demoStep = ref(0), demoScenario = ref('');
watch(() => roomTemplate.value?.id, () => { demoOpen.value = Boolean(roomTemplate.value?.id?.startsWith('cisco-')); demoStep.value = 0; demoScenario.value = roomTemplate.value?.scenarios[0]?.id || ''; });
async function runDemoScenario() {
  sharingSimulation.value = false; simulationOpen.value = true; await nextTick();
  if (!simulationPanel.value?.startScenario(demoScenario.value)) setNotice('ผังเดโมมีอุปกรณ์หรือสายหายไป กรุณาตรวจ Scenario ที่เลือก');
}
function showDemoCli() {
  const node = topology.value.nodes.find(supportsCiscoCli);
  if (node) { selectedId.value = node.id; selectedKind.value = 'node'; ciscoOpen.value = true; }
}
function downloadDemoCli() {
  download(`${roomTemplate.value.id}-cli.txt`, topology.value.nodes.filter(n => n.data.cisco).map(n => `! ${n.label} · ${modelFor(n).name}\n${n.data.cisco.commands.join('\n')}`).join('\n\n'), 'text/plain;charset=utf-8');
}
const rooms = ref([]);
const roomSearch = ref(''), roomsLoading = ref(false);
const room = ref(null);
const topology = ref({ nodes: [], edges: [] });
const participants = ref([]);
const communityOpen = ref(false);
const createTutorialOpen = ref(false);
const createTutorialStep = ref(0);
const createRoomPanel = ref(null);
const visitorVerified = ref(false);
const visitorCaptchaOpen = ref(false);
const creationSteps = [
  { title: 'ชื่อห้องพร้อมแล้ว', text: 'ระบบตั้งชื่อห้องให้แล้ว คุณใช้ชื่อนี้ได้ทันที หรือเปลี่ยนเป็นชื่อที่ทีมจำง่าย เช่น HQ Network แล้วกดถัดไป' },
  { title: 'บอกชื่อของคุณ', text: 'กรอกชื่อที่จะแสดงในรายชื่อสมาชิกและข้อความแชท เพื่อให้เพื่อนรู้ว่าใครกำลังทำงานอยู่' },
  { title: 'เลือกสิทธิ์ให้ทีม', text: 'แก้ไขได้: สมาชิกช่วยออกแบบเครือข่ายได้ · ดูอย่างเดียว: สมาชิกดูเครือข่ายและแชทได้ คำอธิบายห้องไม่จำเป็นต้องกรอก' },
  { title: 'พร้อมสร้างห้องแล้ว', text: 'ตรวจชื่อห้องและชื่อของคุณ แล้วกดสร้างห้องจริง ระบบจะเปิดพื้นที่ทำงานให้คุณ แชร์ Room code ให้เพื่อนเข้าร่วมได้เลย' },
];
const canAdvanceTutorial = computed(() => createTutorialStep.value === 1 ? Boolean(createForm.value.displayName.trim()) : true);
async function focusCreationStep() {
  await nextTick();
  const target = createRoomPanel.value?.querySelector(`[data-tutorial-step="${createTutorialStep.value}"]`);
  target?.scrollIntoView?.({ behavior: 'auto', block: 'center' });
  (target?.querySelector('input, select') || target)?.focus?.();
}
async function startCreationTutorial() {
  selectedPreset.value = null; setView('rooms'); createTutorialStep.value = 0; createTutorialOpen.value = true;
  await focusCreationStep();
}
async function changeCreationStep(step) { createTutorialStep.value = step; await focusCreationStep(); }
function closeCreationTutorial() { createTutorialOpen.value = false; localStorage.setItem('netaxis-tutorial-seen', '1'); }
const chatMessages = ref([]);
const chatCursor = ref(0);
const unreadMessages = ref(0);
async function postRoom(path, body) {
  try { return await api(path, { method: 'POST', body: JSON.stringify(body) }); }
  catch (error) {
    if (error.body?.error === 'VISITOR_UNVERIFIED') { visitorVerified.value = false; visitorCaptchaOpen.value = true; }
    throw error;
  }
}
async function verifyVisitorCaptcha(captcha) {
  await api('/api/captcha/verify', { method: 'POST', body: JSON.stringify({ captcha }) });
  visitorVerified.value = true; visitorCaptchaOpen.value = false;
  await bootstrap();
}
async function checkVisitor() {
  booting.value = true;
  try {
    visitorVerified.value = Boolean((await api('/api/visitor')).verified);
    if (visitorVerified.value) await bootstrap();
    else visitorCaptchaOpen.value = true;
  } catch (error) { errorMessage.value = error.message; }
  finally { booting.value = false; }
}
function receiveChat(payload, notify = true) {
  if (!payload) return;
  const known = new Set(chatMessages.value.map(message => message.id));
  const added = (payload.messages || []).filter(message => !known.has(message.id));
  if (notify && !communityOpen.value) unreadMessages.value += added.filter(message => message.participantId !== participant.value?.id).length;
  chatMessages.value = [...chatMessages.value, ...added].sort((a, b) => a.id - b.id).slice(-100);
  chatCursor.value = Math.max(chatCursor.value, payload.cursor || 0);
}
function receiveRoomMessage(message) { receiveChat({ messages: [message] }); }
function toggleCommunity() { communityOpen.value = !communityOpen.value; if (communityOpen.value) unreadMessages.value = 0; }
async function copyRoomCode() {
  try { await navigator.clipboard.writeText(room.value.joinCode); setNotice('คัดลอก Room code แล้ว ส่งให้เพื่อนเข้าร่วมได้เลย'); }
  catch { setNotice(`Room code: ${room.value.joinCode}`, 0); }
}
const account = ref(null);
function clearAccount() {
  resetEditor(); account.value=null; room.value=null; participant.value=null; rooms.value=[];
  topology.value={nodes:[],edges:[]}; notice.value=''; clearError();
  createForm.value={name:DEFAULT_ROOM_NAME,description:'',accessMode:'editor',displayName:''};
  joinForm.value={joinCode:'',displayName:'',role:'editor',recoveryKey:''};
  createError.value=''; joinError.value=''; restoreFile.value=null; restoreName.value='';
  setView('rooms');
}

async function onAuthenticated(user) {
  account.value = user;
  createForm.value.displayName ||= user.email.split('@')[0].slice(0,60);
  joinForm.value.displayName ||= createForm.value.displayName;
  await bootstrap();
}
function logoutAccount() { if (plannerOpen.value) plannerPanel.value?.requestClose(logoutAccountNow); else return logoutAccountNow(); }
async function logoutAccountNow() {
  if (loading.value) return; loading.value = true;
  try { await api('/api/auth/logout', {method:'POST'}); clearAccount(); }
  catch (e) { errorMessage.value=e.message; } finally {loading.value=false;}
}
const sessionId = ref("");
const participant = ref(null);
const socket = ref(null);
const connectionState = ref("offline");
const saveState = ref("saved");
const errorMessage = ref("");
const notice = ref("");
const loading = ref(false);
const mutationBusy = ref(false);
const booting = ref(true);
const settingsOpen = ref(false);
const roomSettings = ref({ name: "", description: "", accessMode: "editor" });
const recoveryKey = ref("");
const deleteRoomOpen = ref(false);
const selectedId = ref(null);
const selectedKind = ref("node");
const deleteTarget = ref(null);
const connectMode = ref(false);
const pendingSource = ref(null);
const pendingSourceSide = ref(null);
const search = ref("");
const filterStatus = ref("all");
const showTools = ref(false);
const inspectorTab = ref('general');
watch(selectedId, () => { inspectorTab.value = 'general' });
const showImport = ref(false);
const restoreFile = ref(null);
const restoreName = ref('');
const exportBusy = ref(false);
const importText = ref("");
const createForm = ref({
  name: DEFAULT_ROOM_NAME,
  description: "",
  accessMode: "editor",
  displayName: localStorage.getItem("netaxis-name") || "",
});
const createError = ref('');
const joinError = ref('');
const joinForm = ref({
  joinCode: "",
  displayName: localStorage.getItem("netaxis-name") || "",
  role: "editor",
  recoveryKey: "",
});
const subnetForm = ref({ ip: "", cidr: 24 });
const subnetResult = ref(null);
const canvas = ref({ width: 1200, height: 720 });
const camera = ref({ x: 0, y: 0, zoom: 1 });
const drag = ref(null);
const pan = ref(null);
const history = ref([]);
const future = ref([]);
const lastRevision = ref(0);
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const mobileLeftOpen = ref(false);
const mobileDiagramVisible = ref(false);
const mobileRightOpen = ref(false);
const compactMedia = window.matchMedia?.('(max-width: 900px)');
const compactWorkspace = ref(compactMedia?.matches || false);
function updateCompactWorkspace(event) { compactWorkspace.value = event.matches; mobileLeftOpen.value = false; mobileRightOpen.value = false; }
function toggleMobilePanel(side) {
  if (side === 'left') { mobileLeftOpen.value = !mobileLeftOpen.value; mobileRightOpen.value = false; }
  else { mobileRightOpen.value = !mobileRightOpen.value; mobileLeftOpen.value = false; }
  nextTick(() => document.querySelector(side === 'left' ? '#device-sidebar:not([inert]) .mobile-panel-heading button' : '#inspector-sidebar:not([inert]) .mobile-panel-heading button')?.focus({ preventScroll: true }));
}
function closeMobilePanel(side) {
  if (side === 'left') mobileLeftOpen.value = false;
  else mobileRightOpen.value = false;
  nextTick(() => document.querySelector(`[aria-controls="${side === 'left' ? 'device-sidebar' : 'inspector-sidebar'}"]`)?.focus({ preventScroll: true }));
}
function openMobileInspector() {
  if (!compactWorkspace.value) return;
  mobileLeftOpen.value = false; mobileRightOpen.value = true;
  nextTick(() => document.querySelector('#inspector-sidebar .mobile-panel-heading button')?.focus({ preventScroll: true }));
}
const linkDraft = ref(null);
const connectionDraft = ref(null);
const validationOpen = ref(false);
const networkIssues = computed(() => validateNetwork(topology.value));
const showVlans = ref(false);
const ipv6QuickPlan = ref(null);
const ipv6QuickOpen = ref(false);
const collaborationState = ref({ voice: [], moves: [], signals: [], cursor: 0 });
const remoteMoves = ref({});
let stopCollaboration = null, previewSending = false, previewTime = 0;
async function sendCollaboration(command) {
  if (!room.value) throw new Error('ห้องปิดแล้ว');
  return api(`/api/rooms/${room.value.id}/collaboration`, { method: 'POST', headers: { 'x-session-id': sessionId.value }, body: JSON.stringify(command) });
}
function receivePreview(move) {
  if (!move || move.participantId === participant.value?.id || move.revision < lastRevision.value) return;
  remoteMoves.value = { ...remoteMoves.value, [move.nodeId]: move };
}
function displayNode(node) {
  const move = remoteMoves.value[node.id];
  return move && move.expiresAt > roomClock.value && move.revision === lastRevision.value && drag.value?.id !== node.id ? { ...node, position: move.position, editingBy: move.displayName } : node;
}
function previewNode(node) {
  if (previewSending || Date.now() - previewTime < 180) return;
  previewSending = true; previewTime = Date.now();
  sendCollaboration({ action: 'move', nodeId: node.id, position: { ...node.position }, revision: lastRevision.value }).catch(() => {}).finally(() => { previewSending = false });
}
function wireCollaboration() {
  stopCollaboration?.(); const id = room.value.id;
  collaborationState.value = { voice: [], moves: [], signals: [], cursor: 0 }; remoteMoves.value = {};
  stopCollaboration = startRoomSync({ interval: 800, hidden: () => false,
    request: () => api(`/api/rooms/${id}/collaboration?after=${collaborationState.value.cursor}`, { headers: { 'x-session-id': sessionId.value } }),
    receive: state => { if (room.value?.id !== id) return; collaborationState.value = state; state.moves.forEach(receivePreview); },
    failure: () => {},
  });
}
function availablePorts(nodeId, exceptEdgeId) {
  const node = topology.value.nodes.find(n => n.id === nodeId);
  if (!node) return [];
  const used = new Set(resolvedPorts(topology.value).filter(e => e.id !== exceptEdgeId).flatMap(e => [e.sourceNodeId === nodeId ? e.sourcePort : null, e.targetNodeId === nodeId ? e.targetPort : null]).filter(Boolean));
  return portsFor(node).filter(p => !used.has(p.id));
}
function prepareConnection(sourceNodeId, targetNodeId, sourceSide = 'right', targetSide = 'left') {
  const sourcePort = availablePorts(sourceNodeId)[0]?.id, targetPort = availablePorts(targetNodeId)[0]?.id;
  if (!sourcePort || !targetPort) return setNotice('พอร์ตเต็มแล้ว กรุณาเลือกอุปกรณ์รุ่นที่มีพอร์ตเพิ่ม หรือถอดสายเดิม');
  connectionDraft.value = { sourceNodeId, targetNodeId, sourcePort, targetPort, sourceSide, targetSide, medium: 'ethernet', status: 'active', label: '', bandwidth: '', notes: '' };
}
async function createConnection() { if (connectionDraft.value && await mutate('edge', 'create', connectionDraft.value)) connectionDraft.value = null; }
function edgePortLabel(edge) { const value = resolvedPorts(topology.value).find(e => e.id === edge.id); return value ? `${value.sourcePort || '?'} ↔ ${value.targetPort || '?'}` : ''; }
function edgeLabelWidth(edge) { return Math.max(140, Math.max(edgePortLabel(edge).length, showVlans.value ? edgeVlanLabel(edge).length : 0) * 7 + 18); }
function edgeVlanLabel(edge) {
  const link = resolvedPorts(topology.value).find(e => e.id === edge.id);
  if (!link) return '';
  const a = topology.value.nodes.find(n => n.id === link.sourceNodeId), b = topology.value.nodes.find(n => n.id === link.targetNodeId);
  const ap = a && portsFor(a).find(p => p.id === link.sourcePort), bp = b && portsFor(b).find(p => p.id === link.targetPort);
  if (!ap || !bp) return 'Invalid port';
  const vlans = [...new Set([ap.vlan, bp.vlan, ...ap.allowedVlans, ...bp.allowedVlans])].filter(v => linkAllows(topology.value, link, v));
  return vlans.length ? `VLAN ${vlans.slice(0, 3).join(',')}${vlans.length > 3 ? '…' : ''}${ap.mode === 'trunk' && bp.mode === 'trunk' ? ' · trunk' : ''}` : 'VLAN / port mismatch';
}
function changeDeviceType(type) { mutate('node', 'update', { ...selected.value, type, data: { ...selected.value.data, model: deviceModels.find(m => m.type === type).id, ports: [] } }); }
const canvasStage = ref(null);
const simulationOpen = ref(false);
const simulationPackets = ref([]);
const simulationEpoch = ref(0);
const simulationPanel = ref(null);
const sharedSimulation = ref(null);
const sharingSimulation = ref(false);
const simulationCommandBusy = ref(false);
let seenSimulationRun = null;
function receiveRoomSimulation(state) {
  if (state && sharedSimulation.value && (state.revision < sharedSimulation.value.revision || (state.revision === sharedSimulation.value.revision && state.serverTime < sharedSimulation.value.serverTime))) return;
  const newRun = state?.request && state.runId !== seenSimulationRun;
  sharedSimulation.value = state;
  if (newRun) { seenSimulationRun = state.runId; sharingSimulation.value = true; simulationOpen.value = true; }
}
async function roomSimulationCommand(command) {
  if (simulationCommandBusy.value || !canEdit.value) return;
  simulationCommandBusy.value = true;
  try {
    const response = await api(`/api/rooms/${room.value.id}/simulation`, { method: 'POST', headers: { 'x-session-id': sessionId.value }, body: JSON.stringify({ ...command, revision: sharedSimulation.value?.revision || 0, topologyRevision: lastRevision.value }) });
    receiveRoomSimulation(response.simulation);
  } catch (error) { setNotice(error.message); }
  finally { simulationCommandBusy.value = false; }
}
const simulationPicking = ref({ phase: "", source: "" });
const roomClock = ref(Date.now());
let roomClockTimer;
const roomTimeLabel = computed(() => roomTimeLeft(room.value, roomClock.value));
const visibleRooms = computed(() => rooms.value.filter(item => !roomExpired(item, roomClock.value)));
const filteredRooms = computed(() => visibleRooms.value.filter(item => `${item.name} ${item.description} ${item.joinCode}`.toLowerCase().includes(roomSearch.value.trim().toLowerCase())));

const selected = computed(() =>
  selectedKind.value === "node"
    ? topology.value.nodes.find((item) => item.id === selectedId.value) || null
    : topology.value.edges.find((item) => item.id === selectedId.value) || null,
);

const visibleNodes = computed(() =>
  topology.value.nodes.map(displayNode).filter((node) => {
    const matchesSearch =
      !search.value ||
      `${node.label} ${node.type} ${node.data?.vlan || ""} ${node.data?.ipv4 || ""}`
        .toLowerCase()
        .includes(search.value.toLowerCase());
    const matchesStatus =
      filterStatus.value === "all" || node.data?.status === filterStatus.value;
    return matchesSearch && matchesStatus;
  }),
);

const sortedEdges = computed(() => {
  const nodeIds = new Set(visibleNodes.value.map(node => node.id));
  return topology.value.edges.filter(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
});
const simulationEdgeIds = computed(() => new Set(simulationPackets.value.flatMap(packet => packet.route.edgeIds)));
const canEdit = computed(
  () =>
    participant.value && ["owner", "editor"].includes(participant.value.role) && !mutationBusy.value,
);
const connectionLabel = computed(
  () =>
    ({
      connected: "Connected",
      connecting: "Connecting",
      reconnecting: "Reconnecting",
      offline: "Offline",
    })[connectionState.value] || "Offline",
);

function presetPath(preset, edge) {
  const source = preset.nodes.find((node) => node.id === edge.sourceNodeId);
  const target = preset.nodes.find((node) => node.id === edge.targetNodeId);
  if (!source || !target) return "";
  const sourceSide = edge.sourceSide || (target.position.x >= source.position.x ? "right" : "left");
  const targetSide = edge.targetSide || (sourceSide === "right" ? "left" : "right");
  const sx = source.position.x + (sourceSide === "left" ? 0 : 144);
  const sy = source.position.y + 34;
  const tx = target.position.x + (targetSide === "left" ? 0 : 144);
  const ty = target.position.y + 34;
  const direction = tx >= sx ? 1 : -1;
  const curve = Math.max(35, Math.abs(tx - sx) * 0.22);
  return `M ${sx} ${sy} C ${sx + curve * direction} ${sy}, ${tx - curve * direction} ${ty}, ${tx} ${ty}`;
}

function openPreset(preset) {
  selectedPreset.value = preset;
  setView('project');
}

function closePreset() {
  selectedPreset.value = null;
  setView('templates');
}

function setNotice(message, timeout = 6000) {
  notice.value = message;
  if (timeout)
    window.setTimeout(() => {
      if (notice.value === message) notice.value = "";
    }, timeout);
}

function clearError() {
  errorMessage.value = "";
}
function rememberName(name) {
  if (name) localStorage.setItem("netaxis-name", name);
}

async function loadRooms() {
  if (roomsLoading.value) return;
  roomsLoading.value = true;
  try {
    rooms.value = (await api("/api/rooms")).rooms;
  } catch (error) {
    errorMessage.value = error.message;
  } finally { roomsLoading.value = false; }
}

function applySync(payload) {
  if (!payload?.room) return;
  roomTemplate.value = payload.template || null;
  resetSimulation();
  room.value = payload.room;
  topology.value = { nodes: payload.nodes || [], edges: payload.edges || [] };
  lastRevision.value = payload.room.revision;
  if (payload.participants) participants.value = payload.participants;
  if (selectedId.value && !topology.value[selectedKind.value + "s"].some(item => item.id === selectedId.value)) selectedId.value = null;
  history.value = []; future.value = [];
  saveState.value = "saved";
  receiveRoomSimulation(payload.simulation || null);
}

function replaceEntity(kind, entity) {
  const list = topology.value[`${kind}s`];
  const index = list.findIndex((item) => item.id === entity.id);
  if (index >= 0) list[index] = entity;
  else list.push(entity);
}

function removeEntity(kind, id) {
  if (kind === "node") {
    topology.value.edges = topology.value.edges.filter(
      (edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id,
    );
    resetSimulation();
  }
  topology.value[`${kind}s`] = topology.value[`${kind}s`].filter(
    (item) => item.id !== id,
  );
  if (selectedId.value === id) selectedId.value = null;
}

function wireSocket() {
  stopCloudSync?.(); stopCloudSync = null;
  socket.value?.removeAllListeners(); socket.value?.disconnect();
  connectionState.value = "connecting";
  if (CLOUD_MODE) {
    const id = room.value.id, token = sessionId.value;
    stopCloudSync = startRoomSync({
      request: () => api(`/api/rooms/${id}/sync`, { method: 'POST', headers: { 'x-session-id': token }, body: JSON.stringify({ revision: lastRevision.value, tabId, chatCursor: chatCursor.value }) }),
      paused: () => mutationBusy.value || Boolean(drag.value) || saveState.value === 'saving',
      receive: payload => {
        if (room.value?.id !== id) return;
        connectionState.value = 'connected';
        participants.value = payload.participants || [];
        receiveChat(payload.chat);
        if (participant.value) participant.value.role = payload.participant.role;
        if (payload.topology && payload.room.revision > lastRevision.value && !mutationBusy.value && !drag.value) applySync(payload.topology);
        if (payload.room.revision === lastRevision.value) room.value = payload.room;
        receiveRoomSimulation(payload.simulation || null);
      },
      failure: error => {
        if (room.value?.id !== id) return;
        if (error.status === 410) { handleRoomExpired(); return; }
        if ([401, 403, 404].includes(error.status)) { leaveRoomNow(); setNotice(error.status === 404 ? 'ห้องนี้ถูกลบแล้ว' : 'Session หมดอายุ กรุณาเข้าร่วมห้องใหม่'); return; }
        connectionState.value = 'reconnecting';
      },
    });
    return;
  }
  const currentSocket = io(SOCKET_ORIGIN || undefined, { auth: { sessionId: sessionId.value, roomId: room.value.id }, withCredentials: true, transports: SOCKET_ORIGIN ? ["websocket"] : ["websocket", "polling"] });
  socket.value = currentSocket;
  currentSocket.on('node:preview', receivePreview);
  currentSocket.on("connect", () => { connectionState.value = "connected"; });
  currentSocket.on("connect_error", (error) => {
    if (error.data?.code === 'ROOM_EXPIRED') { handleRoomExpired(); return; }
    connectionState.value = currentSocket.active ? "reconnecting" : "offline";
    if (!currentSocket.active) errorMessage.value = "Session หมดอายุ กรุณาออกจากห้องแล้วเข้าร่วมใหม่: " + error.message;
  });
  currentSocket.io.on("reconnect_attempt", () => { connectionState.value = "reconnecting"; });
  currentSocket.on("disconnect", () => { connectionState.value = "offline"; });
  currentSocket.on("room:sync", payload => {
    receiveChat(payload.chat);
    if (payload.room.revision >= lastRevision.value) applySync(payload);
  });
  currentSocket.on('room:message', payload => receiveRoomMessage(payload.message));
  currentSocket.on("room:presence", payload => {
    participants.value = payload.participants || [];
    const current = participants.value.find(person => person.id === participant.value?.id);
    if (current && participant.value) participant.value.role = current.role;
  });
  currentSocket.on("room:updated", payload => { room.value = payload.room; });
  currentSocket.on('room:simulation', payload => receiveRoomSimulation(payload.simulation));
  currentSocket.on("session:ended", () => { resetEditor(); participant.value = null; room.value = null; setView('rooms'); bootstrap(); });
  currentSocket.on("room:deleted", () => { leaveRoomNow(); setNotice("เจ้าของห้องลบห้องนี้แล้ว"); });
  currentSocket.on("room:expired", handleRoomExpired);
  for (const kind of ["node", "edge"]) for (const operation of ["create", "update", "delete"]) {
    currentSocket.on(kind + ":" + operation, payload => {
      if (payload.room.revision <= lastRevision.value) return;
      if (payload.actorId !== participant.value?.id) { history.value = []; future.value = []; drag.value = null; }
      if (operation === "delete") removeEntity(kind, payload[kind].id);
      else replaceEntity(kind, payload[kind]);
      room.value = payload.room; lastRevision.value = payload.room.revision;
      if (!mutationBusy.value) saveState.value = "saved";
    });
  }
}

async function openRoom(payload) {
  const completedTutorial = createTutorialOpen.value;
  if (completedTutorial) closeCreationTutorial();
  clearError(); notice.value = ''; roomClock.value = Date.now();
  resetEditor();
  room.value = payload.room;
  sessionId.value = payload.sessionId;
  participant.value = payload.participant;
  participants.value = payload.participants || [];
  receiveChat(payload.chat, false);
  rememberName(payload.participant.displayName);
  localStorage.removeItem("netaxis-session");
  localStorage.removeItem("netaxis-room");
  localStorage.removeItem("netaxis-participant");
  applySync(payload.topology);
  setView('editor');
  await nextTick();
  fitCanvas();
  wireSocket();
  wireCollaboration();
  if (payload.recoveryKey) recoveryKey.value = payload.recoveryKey;
  if (completedTutorial) setNotice('สร้างห้องสำเร็จแล้ว · คัดลอก Room code ด้านบนให้เพื่อน หรือเปิดแชทและสมาชิกเพื่อเริ่มทำงานร่วมกัน', 8000);
}

async function createRoom() {
  if (loading.value || !createForm.value.displayName.trim()) return;
  loading.value = true;
  createError.value = '';
  try {
    clearError();
    const payload = await postRoom('/api/rooms', { ...createForm.value, name: createForm.value.name.trim() || DEFAULT_ROOM_NAME });
    await openRoom(payload);
  } catch (error) {
    createError.value = error.message;
  } finally { loading.value = false; }
}

async function createPresetRoom() {
  if (!selectedPreset.value || loading.value) return;
  loading.value = true;
  try {
    clearError();
    const preset = selectedPreset.value;
    const payload = await postRoom('/api/rooms', {
        templateId: preset.id,
        name: `${preset.name} Project`,
        description: preset.description,
        accessMode: "editor",
        displayName: createForm.value.displayName,
    });
    await openRoom(payload);
    simulationOpen.value = true;
    setNotice(`${preset.name} พร้อมใช้งานแล้ว · เลือก scenario แล้วกด Run ใน Realtime`);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function joinRoom() {
  if (loading.value || !joinForm.value.joinCode.trim() || !joinForm.value.displayName.trim()) return;
  loading.value = true;
  joinError.value = '';
  try {
    clearError();
    const payload = await postRoom('/api/rooms/join', { ...joinForm.value });
    await openRoom(payload);
  } catch (error) {
    joinError.value = error.message;
  } finally { loading.value = false; }
}

async function rejoinSavedRoom(roomId) {
  try {
    let payload;
    try { payload = await api('/api/session'); }
    catch (error) { if (error.status !== 401 || error.body?.error === 'LOGIN_REQUIRED') throw error; payload = await api(`/api/rooms/${roomId}/resume`, {method:'POST'}); }
    if (payload.room.id !== roomId) payload = await api(`/api/rooms/${roomId}/resume`, { method: 'POST' });
    await openRoom(payload);
  } catch (error) { setView('rooms'); if (error.status !== 401) errorMessage.value = error.message; }
}

function leaveRoom() { if (plannerOpen.value) plannerPanel.value?.requestClose(leaveRoomNow); else return leaveRoomNow(); }
async function leaveRoomNow(destination = 'rooms') {
  resetEditor();
  room.value = null; participant.value = null;
  topology.value = { nodes: [], edges: [] };
  setView(destination);
  try { await api("/api/session/leave", { method: "POST", body: JSON.stringify({ tabId }) }); }
  catch (error) { errorMessage.value = error.message; }
  await loadRooms();
}

function selectNode(node) {
  if (simulationPicking.value.phase) { simulationPanel.value?.pickNode(node.id); return; }
  if (connectMode.value) {
    if (!pendingSource.value) {
      pendingSource.value = node.id;
      return;
    }
    if (pendingSource.value !== node.id) {
      const source = pendingSource.value;
      pendingSource.value = null;
      connectMode.value = false;
      prepareConnection(source, node.id);
    }
    return;
  }
  selectedId.value = node.id;
  selectedKind.value = "node";
  openMobileInspector();
}

function selectEdge(edge) {
  if (connectMode.value) return;
  selectedId.value = edge.id;
  selectedKind.value = "edge";
  openMobileInspector();
}
function connectPort(node, side) {
  if (!canEdit.value) return;
  if (!pendingSource.value) { connectMode.value = true; pendingSource.value = node.id; pendingSourceSide.value = side; return; }
  if (pendingSource.value === node.id) return;
  const sourceNodeId = pendingSource.value, sourceSide = pendingSourceSide.value;
  pendingSource.value = null; pendingSourceSide.value = null; connectMode.value = false;
  prepareConnection(sourceNodeId, node.id, sourceSide || 'right', side);
}
function startPaletteDrag(event, type) {
  if (!canEdit.value) { event.preventDefault(); return; }
  event.dataTransfer.setData("application/x-netaxis-device", type);
  event.dataTransfer.effectAllowed = "copy";
}
function dropDevice(event) {
  const type = event.dataTransfer.getData("application/x-netaxis-device");
  if (!canEdit.value || !deviceByType[type]) return;
  const point = canvasPoint(event), position = screenToWorld(point.x, point.y);
  deviceDraft.value = { type, position: { x: position.x - 72, y: position.y - 34 } };
}

function toggleSimulation() {
  simulationOpen.value = !simulationOpen.value;
  if (!simulationOpen.value) resetSimulation();
}
function resetSimulation() {
  simulationEpoch.value++;
  simulationPackets.value = [];
  simulationPicking.value = { phase: "", source: "" };
}
function setPduPicking(value) {
  simulationPicking.value = value;
  mobileDiagramVisible.value = Boolean(value.phase);
  if (value.phase) { connectMode.value = false; pendingSource.value = null; linkDraft.value = null; }
}

function isSimulationEdge(edgeId) {
  return simulationEdgeIds.value.has(edgeId);
}

function edgeTraversalPoints(edge, fromNodeId, toNodeId) {
  const geometry = edgeGeometry(edge);
  if (!geometry) return null;
  if (
    fromNodeId === edge.sourceNodeId &&
    toNodeId === edge.targetNodeId
  ) {
    return geometry;
  }
  if (
    fromNodeId === edge.targetNodeId &&
    toNodeId === edge.sourceNodeId
  ) {
    return {
      start: geometry.end,
      end: geometry.start,
      controlStart: geometry.controlEnd,
      controlEnd: geometry.controlStart,
    };
  }
  return null;
}

function cubicPoint(points, progress) {
  const { start, end, controlStart, controlEnd } = points;
  const inverse = 1 - progress;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * progress * controlStart.x +
      3 * inverse * progress ** 2 * controlEnd.x +
      progress ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * progress * controlStart.y +
      3 * inverse * progress ** 2 * controlEnd.y +
      progress ** 3 * end.y,
  };
}

function packetPosition(packet) {
  if (!packet.route.edgeIds.length) {
    const node = topology.value.nodes.find(item => item.id === packet.route.nodeIds[0]);
    return node ? { x: node.position.x + 120, y: node.position.y - 12 } : null;
  }
  const edgeId = packet.route.edgeIds[packet.edgeIndex];
  const edge = topology.value.edges.find((item) => item.id === edgeId);
  const fromNodeId = packet.route.nodeIds[packet.edgeIndex];
  const toNodeId = packet.route.nodeIds[packet.edgeIndex + 1];
  const points = edge && edgeTraversalPoints(edge, fromNodeId, toNodeId);
  return points ? cubicPoint(points, packet.progress) : null;
}

function nodePortPosition(node, side = "right") {
  return {
    x: node.position.x + (side === "left" ? 0 : 144),
    y: node.position.y + 34,
  };
}

function startLinkDrag(event, node, side) {
  if (!canEdit.value) return;
  event.stopPropagation();
  const point = canvasPoint(event);
  const source = nodePortPosition(node, side);
  linkDraft.value = {
    sourceNodeId: node.id,
    sourceSide: side,
    point: screenToWorld(point.x, point.y),
  };
  selectedId.value = node.id;
  selectedKind.value = "node";
  canvasStage.value?.setPointerCapture?.(event.pointerId);
}

function moveLinkDrag(event) {
  if (!linkDraft.value) return;
  const point = canvasPoint(event);
  linkDraft.value.point = screenToWorld(point.x, point.y);
}

function finishLinkDrag(event, node, side) {
  if (!linkDraft.value) return;
  event?.stopPropagation?.();
  const draft = linkDraft.value;
  linkDraft.value = null;
  if (draft.sourceNodeId === node.id) return;
  const sourceNode = topology.value.nodes.find(
    (item) => item.id === draft.sourceNodeId,
  );
  if (!sourceNode) return;
  const targetSide =
    side || (node.position.x >= sourceNode.position.x ? "left" : "right");
  prepareConnection(draft.sourceNodeId, node.id, draft.sourceSide, targetSide);
}

function finishNodePointerUp(event, node) {
  if (linkDraft.value) return finishLinkDrag(event, node);
  finishNodeDrag();
}

function draftPath() {
  if (!linkDraft.value) return "";
  const sourceNode = topology.value.nodes.find(
    (node) => node.id === linkDraft.value.sourceNodeId,
  );
  if (!sourceNode) return "";
  const source = nodePortPosition(sourceNode, linkDraft.value.sourceSide);
  const target = linkDraft.value.point;
  const direction = target.x >= source.x ? 1 : -1;
  const curve = Math.max(45, Math.abs(target.x - source.x) * 0.28);
  return `M ${source.x} ${source.y} C ${source.x + curve * direction} ${source.y}, ${target.x - curve * direction} ${target.y}, ${target.x} ${target.y}`;
}

function addNode(type) {
  if (!canEdit.value) return setNotice("คุณมีสิทธิ์ดูอย่างเดียว");
  const center = screenToWorld(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  deviceDraft.value = { type, position: { x: center.x - 72, y: center.y - 34 } };
}
async function addSelectedDevice(model, label) {
  if (!deviceDraft.value || !canEdit.value || model.type !== deviceDraft.value.type) return false;
  return mutate('node', 'create', { type: model.type, label, position: deviceDraft.value.position, data: { status: 'unknown', model: model.id, vendor: model.brand || '' } });
}

function screenToWorld(x, y) {
  return {
    x: (x - camera.value.x) / camera.value.zoom,
    y: (y - camera.value.y) / camera.value.zoom,
  };
}
function worldToScreen(point) {
  return {
    x: point.x * camera.value.zoom + camera.value.x,
    y: point.y * camera.value.zoom + camera.value.y,
  };
}

function canvasPoint(event) {
  const svg = canvas.value;
  if (!svg?.createSVGPoint || !svg.getScreenCTM()) return { x: 0, y: 0 };
  const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function startNodeDrag(event, node) {
  event.stopPropagation();
  if (connectMode.value || simulationPicking.value.phase) return;
  selectNode(node);
  if (!canEdit.value) return;
  const point = canvasPoint(event);
  drag.value = {
    id: node.id,
    before: clone(topology.value),
    start: { ...node.position },
    offset: {
      x: (point.x - camera.value.x) / camera.value.zoom - node.position.x,
      y: (point.y - camera.value.y) / camera.value.zoom - node.position.y,
    },
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function moveNode(event) {
  if (!drag.value) return;
  const point = canvasPoint(event);
  const node = topology.value.nodes.find((item) => item.id === drag.value.id);
  if (!node) return;
  node.position = {
    x: (point.x - camera.value.x) / camera.value.zoom - drag.value.offset.x,
    y: (point.y - camera.value.y) / camera.value.zoom - drag.value.offset.y,
  };
  previewNode(node);
  saveState.value = "saving";
}

function handleStagePointerUp(event) {
  if (linkDraft.value) {
    const point = canvasPoint(event), world = screenToWorld(point.x, point.y);
    const target = [...visibleNodes.value].reverse().find(node => world.x >= node.position.x - 8 && world.x <= node.position.x + 152 && world.y >= node.position.y - 8 && world.y <= node.position.y + 76);
    if (target) finishLinkDrag(event, target, world.x < target.position.x + 72 ? "left" : "right");
    else linkDraft.value = null;
  }
  finishNodeDrag(); finishPan();
}
function cancelCanvasInteraction() {
  if (drag.value) topology.value = drag.value.before;
  drag.value = null; linkDraft.value = null; finishPan(); saveState.value = "saved";
}

function finishNodeDrag() {
  if (!drag.value) return;
  const current = drag.value, node = topology.value.nodes.find(item => item.id === current.id);
  drag.value = null;
  if (node && (node.position.x !== current.start.x || node.position.y !== current.start.y)) mutate("node", "update", node, { before: current.before });
  else saveState.value = "saved";
}

function startPan(event) {
  if (event.target.closest(".node-group, .edge-group, .simulation-panel, button, input, select, textarea, label")) return;
  const point = canvasPoint(event);
  pan.value = { x: point.x, y: point.y, camera: { ...camera.value } };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function movePan(event) {
  if (!pan.value) return;
  const point = canvasPoint(event);
  camera.value.x = pan.value.camera.x + point.x - pan.value.x;
  camera.value.y = pan.value.camera.y + point.y - pan.value.y;
}

function moveCanvasInteraction(event) {
  movePan(event);
  moveNode(event);
  moveLinkDrag(event);
}

function finishPan() {
  pan.value = null;
}

function zoomCanvas(event) {
  event.preventDefault();
  const point = canvasPoint(event);
  const before = screenToWorld(point.x, point.y);
  const nextZoom = Math.min(
    4,
    Math.max(0.2, camera.value.zoom * (event.deltaY > 0 ? 0.9 : 1.1)),
  );
  camera.value.zoom = nextZoom;
  camera.value.x = point.x - before.x * nextZoom;
  camera.value.y = point.y - before.y * nextZoom;
}

function zoomBy(amount) {
  const before=screenToWorld(CANVAS_WIDTH/2,CANVAS_HEIGHT/2);
  const zoom=Math.max(.2,Math.min(4,camera.value.zoom+amount));
  camera.value={zoom,x:CANVAS_WIDTH/2-before.x*zoom,y:CANVAS_HEIGHT/2-before.y*zoom};
}
function locateOnMap(event) {
  const svg=event.currentTarget, point=svg.createSVGPoint(); point.x=event.clientX; point.y=event.clientY;
  const at=point.matrixTransform(svg.getScreenCTM().inverse());
  camera.value={...camera.value,x:CANVAS_WIDTH/2-at.x*camera.value.zoom,y:CANVAS_HEIGHT/2-at.y*camera.value.zoom};
}
function fitCanvas() {
  if (!topology.value.nodes.length) {
    camera.value = { x: 0, y: 0, zoom: 1 };
    return;
  }
  const xs = topology.value.nodes.map((node) => node.position.x);
  const ys = topology.value.nodes.map((node) => node.position.y);
  const minX = Math.min(...xs) - 120;
  const maxX = Math.max(...xs) + 260;
  const minY = Math.min(...ys) - 100;
  const maxY = Math.max(...ys) + 150;
  const zoom = Math.min(
    CANVAS_WIDTH / (maxX - minX),
    CANVAS_HEIGHT / (maxY - minY),
    1.3,
  );
  camera.value = {
    x: (CANVAS_WIDTH - (minX + maxX) * zoom) / 2,
    y: (CANVAS_HEIGHT - (minY + maxY) * zoom) / 2,
    zoom,
  };
}

async function mutate(kind, operation, payload, options = {}) {
  if (!canEdit.value || mutationBusy.value) return false;
  mutationBusy.value = true;
  saveState.value = "saving"; clearError();
  const before = clone(options.before || topology.value);
  const roomId = room.value.id;
  try {
    const endpoint = operation === "create" ? "/api/rooms/" + roomId + "/" + kind + "s" : "/api/rooms/" + roomId + "/" + kind + "s/" + encodeURIComponent(payload.id);
    const response = await api(endpoint, {
      method: operation === "create" ? "POST" : operation === "update" ? "PATCH" : "DELETE",
      headers: { "x-session-id": sessionId.value, "x-topology-revision": String(lastRevision.value) },
      body: operation === "delete" ? undefined : JSON.stringify(payload),
    });
    if (room.value?.id !== roomId) return false;
    if (response.room.revision < lastRevision.value) return true;
    if (operation === "delete") removeEntity(kind, response[kind].id);
    else replaceEntity(kind, response[kind]);
    lastRevision.value = Math.max(lastRevision.value, response.room.revision);
    room.value = response.room;
    if (options.recordHistory !== false && lastRevision.value === response.room.revision) {
      history.value.push({ before, after: clone(topology.value), revision: response.room.revision });
      if (history.value.length > 50) history.value.shift();
      future.value = [];
    }
    saveState.value = "saved";
    return true;
  } catch (error) {
    if (room.value?.id !== roomId) return false;
    if (error.body?.latest) applySync(error.body.latest);
    else if (options.before) { topology.value = before; }
    saveState.value = "error"; errorMessage.value = error.message;
    return false;
  } finally { mutationBusy.value = false; }
}

async function undo() {
  const entry = history.value.at(-1);
  if (!entry || !canEdit.value) return;
  if (entry.revision !== lastRevision.value) { history.value = []; future.value = []; return setNotice("Topology มีการเปลี่ยนแปลงจากผู้ใช้อื่น จึงล้างประวัติ Undo"); }
  const remaining = history.value.slice(0, -1), redoEntries = [...future.value];
  if (await restoreTopology(entry.before)) {
    if (remaining.length) remaining.at(-1).revision = lastRevision.value;
    history.value = remaining;
    future.value = [...redoEntries, { ...entry, revision: lastRevision.value }];
  }
}

async function redo() {
  const entry = future.value.at(-1);
  if (!entry || !canEdit.value) return;
  if (entry.revision !== lastRevision.value) { future.value = []; return; }
  const remaining = future.value.slice(0, -1), undoEntries = [...history.value];
  if (await restoreTopology(entry.after)) {
    if (remaining.length) remaining.at(-1).revision = lastRevision.value;
    future.value = remaining;
    history.value = [...undoEntries, { ...entry, revision: lastRevision.value }];
  }
}

function updateSelected(field, value) {
  if (!selected.value || !canEdit.value) return;
  const updated = clone(selected.value);
  if (selectedKind.value === "node") {
    updated.data = { ...updated.data, [field]: value };
    if (field === "ipv4" && value && updated.data.cidr === undefined) updated.data.cidr = 24;
  } else updated[field] = value;
  mutate(selectedKind.value, "update", updated);
}

function updateNodeField(field, value) {
  updateSelected(field, value);
}
function updateEdgeField(field, value) {
  updateSelected(field, value);
}

function confirmDelete() {
  if (!selected.value || !canEdit.value) return;
  const label = selected.value.label || selected.value.id;
  deleteTarget.value = {
    kind: selectedKind.value,
    id: selected.value.id,
    label,
  };
}

function cancelDelete() {
  deleteTarget.value = null;
}

async function executeDelete() {
  const target = deleteTarget.value;
  if (!target) return;
  deleteTarget.value = null;
  await mutate(target.kind, "delete", { id: target.id });
}

function selectSubnetForNode() {
  if (selectedKind.value === 'node' && !selected.value?.data?.ipv4 && selected.value?.data?.ipv6) {
    const parent = selected.value.data.ipv6;
    const prefix = Number(parent.split('/')[1] || 64);
    ipv6QuickPlan.value = { parent: parent.includes('/') ? parent : `${parent}/64`, prefix, count: 1 };
    ipv6QuickOpen.value = true;
    return;
  }
  if (selectedKind.value !== "node" || !selected.value?.data?.ipv4)
    return setNotice("อุปกรณ์นี้ยังไม่มี IPv4");
  subnetForm.value = {
    ip: selected.value.data.ipv4,
    cidr: selected.value.data.cidr ?? 24,
  };
  calculateSubnet();
}

function calculateSubnet() {
  const result = subnetDetails(subnetForm.value.ip.trim(), subnetForm.value.cidr);
  subnetResult.value = result ? { network: result.networkAddress, broadcast: result.broadcastAddress, mask: result.subnetMask, first: result.firstUsable, last: result.lastUsable, hosts: result.hostCount } : null;
}

async function exportJson() {
  if (exportBusy.value) return;
  exportBusy.value = true;
  try {
    const workspace = await api('/api/rooms/' + room.value.id + '/export', { headers: { 'x-session-id': sessionId.value } });
    download('netaxis-workspace.json', JSON.stringify(workspace, null, 2), 'application/json');
    setNotice('สำรอง Topology, IPAM และ Scenarios แล้ว · กู้คืนเป็นห้องใหม่ได้จากหน้าแรก');
  } catch (error) { errorMessage.value = error.message; }
  finally { exportBusy.value = false; }
}
async function selectRestoreFile(event) {
  restoreFile.value = null; clearError();
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('ไฟล์ Workspace ต้องไม่เกิน 10 MB');
    const workspace = JSON.parse(await file.text());
    if (workspace.format !== 'netaxis-workspace' || workspace.version !== 1 || !Array.isArray(workspace.nodes) || !Array.isArray(workspace.edges) || !workspace.room?.name) throw new Error('เลือกไฟล์ netaxis-workspace.json ที่ Export จากห้อง');
    restoreFile.value = workspace; restoreName.value = createForm.value.displayName;
  } catch (error) { errorMessage.value = error.message; }
  event.target.value = '';
}
async function restoreWorkspace() {
  if (!restoreFile.value || !restoreName.value.trim() || loading.value) return;
  loading.value = true; clearError();
  try {
    const payload = await postRoom('/api/rooms/restore', { displayName: restoreName.value, workspace: restoreFile.value });
    restoreFile.value = null; await openRoom(payload);
    simulationOpen.value = Boolean(payload.topology.template?.scenarios?.length);
    setNotice('กู้คืน Workspace แล้ว · เก็บถาวรในบัญชีของคุณ');
  } catch (error) { errorMessage.value = error.message; }
  finally { loading.value = false; }
}

function exportCsv() {
  const rows = [
    [
      "id",
      "label",
      "type",
      "ipv4",
      "cidr",
      "ipv6",
      "mac",
      "vlan",
      "status",
      "vendor",
      "notes",
    ],
    ...topology.value.nodes.map((node) => [
      node.id,
      node.label,
      node.type,
      node.data?.ipv4 || "",
      node.data?.cidr ?? "",
      node.data?.ipv6 || "",
      node.data?.mac || "",
      node.data?.vlan || "",
      node.data?.status || "",
      node.data?.vendor || "",
      node.data?.notes || "",
    ]),
  ];
  const csv = rows
    .map((row) =>
      row.map(csvCell).join(","),
    )
    .join("\n");
  download("netaxis-devices.csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importJson() {
  if (!canEdit.value) return;
  try {
    const value = JSON.parse(importText.value);
    if (value.format === 'netaxis-workspace') throw new Error('ไฟล์นี้มีแผน IPAM และ Scenarios ด้วย ใช้ “กู้คืน Workspace จากไฟล์” ที่หน้าแรกเพื่อเปิดครบทุกส่วนในห้องใหม่');
    if (!Array.isArray(value?.nodes) || !Array.isArray(value?.edges)) throw new Error("ไฟล์ต้องมี nodes และ edges เป็น array");
    const before = clone(topology.value);
    if (await restoreTopology(value)) {
      history.value = [{ before, after: clone(topology.value), revision: lastRevision.value }];
      showImport.value = false; importText.value = "";
      fitCanvas(); setNotice("นำเข้า topology และบันทึกไปยัง Server แล้ว");
    }
  } catch (error) { errorMessage.value = error.message; }
}

async function exportPng() {
  const svg = canvas.value;
  if (!svg) return;
  try {
    await document.fonts.ready;
    const copy = svg.cloneNode(true), originals = [svg, ...svg.querySelectorAll("*")], copies = [copy, ...copy.querySelectorAll("*")];
    const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "font-family", "font-size", "font-weight", "letter-spacing", "text-anchor", "opacity", "color", "visibility", "display", "filter"];
    originals.forEach((element, index) => {
      const styles = getComputedStyle(element);
      copies[index].setAttribute("style", properties.map(property => property + ":" + styles.getPropertyValue(property).replace(/url\(["']?[^)]*#([^"')]+)["']?\)/g, "url(#$1)")).join(";"));
    });
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg"); copy.setAttribute("width", "1600"); copy.setAttribute("height", "960");
    copy.querySelectorAll(".node-port, .edge-hit, .link-preview, .simulation-packet").forEach(element => element.remove());
    const source = new XMLSerializer().serializeToString(copy);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("ไม่สามารถแปลง SVG เป็นภาพได้")); image.src = url; });
      const bitmap = document.createElement("canvas"); bitmap.width = 1600; bitmap.height = 960;
      const context = bitmap.getContext("2d"); context.fillStyle = "#f5f6f8"; context.fillRect(0, 0, 1600, 960); context.drawImage(image, 0, 0, 1600, 960);
      const blob = await new Promise(resolve => bitmap.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("ไม่สามารถสร้าง PNG ได้");
      download("netaxis-topology.png", blob, "image/png"); setNotice("ส่งออก PNG แล้ว");
    } finally { URL.revokeObjectURL(url); }
  } catch (error) { errorMessage.value = error.message; }
}

function edgePath(edge) {
  const points = edgeGeometry(edge);
  if (!points) return "";
  return cubicPath(points);
}

function edgeGeometry(edge) {
  const source = topology.value.nodes.find(
    (node) => node.id === edge.sourceNodeId,
  );
  const target = topology.value.nodes.find(
    (node) => node.id === edge.targetNodeId,
  );
  if (!source || !target) return null;
  const sourceSide = edge.sourceSide || (target.position.x >= source.position.x ? "right" : "left");
  const targetSide = edge.targetSide || (sourceSide === "right" ? "left" : "right");
  const start = nodePortPosition(displayNode(source), sourceSide);
  const end = nodePortPosition(displayNode(target), targetSide);
  const direction = end.x >= start.x ? 1 : -1;
  const curve = Math.max(40, Math.abs(end.x - start.x) * 0.25);
  return {
    start,
    end,
    controlStart: { x: start.x + curve * direction, y: start.y },
    controlEnd: { x: end.x - curve * direction, y: end.y },
  };
}

function cubicPath(points) {
  const { start, end, controlStart, controlEnd } = points;
  return `M ${start.x} ${start.y} C ${controlStart.x} ${controlStart.y}, ${controlEnd.x} ${controlEnd.y}, ${end.x} ${end.y}`;
}

function edgeMidpoint(edge) {
  const points = edgeGeometry(edge);
  return points ? cubicPoint(points, .5) : { x: 0, y: 0 };
}

function handleKey(event) {
  const menu = document.querySelector('.workspace-menu[open]');
  if (event.key === 'Escape' && menu) { menu.open = false; menu.querySelector('summary')?.focus(); return; }
  if (visitorCaptchaOpen.value || event.target.closest?.('.community-panel')) return;
  if (connectionDraft.value || validationOpen.value || event.target.closest?.('dialog, [role=dialog]')) return;
  if (plannerOpen.value) return;
  if (event.key === "Escape" && simulationPicking.value.phase) simulationPanel.value?.cancelPick();
  if (event.target.closest?.(".simulation-panel")) return;
  if (view.value !== "editor" || event.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
  if (!event.ctrlKey && !event.metaKey && ['+','=','-'].includes(event.key)) { event.preventDefault(); zoomBy(event.key === '-' ? -.2 : .2); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }
  if (event.key === "Escape" && deleteTarget.value) cancelDelete();
  if (event.key === "Delete" && selected.value) confirmDelete();
}
function closeFileMenu(event) {
  const menu = document.querySelector('.workspace-menu[open]');
  if (menu && !menu.contains(event.target)) menu.open = false;
}

onMounted(async () => {
  compactMedia?.addEventListener('change', updateCompactWorkspace);
  window.addEventListener('popstate', handleRoute);
  window.addEventListener("keydown", handleKey);
  document.addEventListener('click', closeFileMenu);
  roomClockTimer = window.setInterval(() => {
    roomClock.value = Date.now();
    if (view.value === 'editor' && roomExpired(room.value, roomClock.value)) handleRoomExpired();
  }, 1000);
  await checkVisitor();
});
onBeforeUnmount(() => {
  compactMedia?.removeEventListener('change', updateCompactWorkspace);
  window.removeEventListener('popstate', handleRoute);
  window.removeEventListener("keydown", handleKey);
  document.removeEventListener('click', closeFileMenu);
  window.clearInterval(roomClockTimer);
  resetEditor();
});


function handleRoomExpired() {
  resetEditor(); room.value = null; participant.value = null;
  topology.value = { nodes: [], edges: [] }; setView('rooms');
  setNotice('ห้องหมดอายุแล้ว · ห้องใหม่เก็บถาวรในบัญชี สามารถสร้างห้องใหม่ได้', 0);
  loadRooms();
}
function resetEditor() {
  ciscoOpen.value = false;
  stopCollaboration?.(); stopCollaboration = null; remoteMoves.value = {}; connectionDraft.value = null; validationOpen.value = false;
  communityOpen.value = false; chatMessages.value = []; chatCursor.value = 0; unreadMessages.value = 0;
  stopCloudSync?.(); stopCloudSync = null;
  sharedSimulation.value = null; sharingSimulation.value = false; seenSimulationRun = null;
  plannerOpen.value = false;
  roomTemplate.value = null;
  socket.value?.removeAllListeners(); socket.value?.disconnect(); socket.value = null;
  connectionState.value = "offline"; resetSimulation(); simulationOpen.value = false;
  history.value = []; future.value = []; selectedId.value = null; deleteTarget.value = null;
  participants.value = []; drag.value = null; pan.value = null; linkDraft.value = null;
  connectMode.value = false; pendingSource.value = null; pendingSourceSide.value = null; search.value = ""; filterStatus.value = "all";
  showImport.value = false; settingsOpen.value = false; deleteRoomOpen.value = false; recoveryKey.value = ""; mobileLeftOpen.value = false; mobileRightOpen.value = false;
  camera.value = { x: 0, y: 0, zoom: 1 }; sessionId.value = ""; saveState.value = "saved";
}
async function bootstrap() {
  booting.value = true;
  try {
    account.value = (await api('/api/auth/me')).user || null;
    if (!account.value) { rooms.value=[]; return; }
    createForm.value.displayName ||= localStorage.getItem('netaxis-name') || account.value.email.split('@')[0].slice(0,60);
    joinForm.value.displayName ||= createForm.value.displayName;
    const path = window.location.pathname;
    const savedRoom = path.match(/^\/room\/([\w-]+)$/);
    const project = path.match(/^\/project\/([\w-]+)$/);
    if (savedRoom) await rejoinSavedRoom(savedRoom[1]);
    else if (path === '/workspace') view.value = 'rooms';
    else if (project && presetProjects.some(p => p.id === project[1])) { selectedPreset.value = presetProjects.find(p => p.id === project[1]); view.value = 'project'; }
    else view.value = window.location.hash === '#templates' ? 'templates' : 'home';
    await loadRooms();
  } catch (error) { errorMessage.value = error.message; }
  finally { booting.value = false; }
}
async function resumeRoom(item) {
  if (loading.value) return;
  loading.value = true;
  try { await openRoom(await api("/api/rooms/" + item.id + "/resume", { method: "POST" })); }
  catch (error) { errorMessage.value = error.message; }
  finally { loading.value = false; }
}
async function restoreTopology(value) {
  if (!canEdit.value) return false;
  const roomId = room.value.id;
  mutationBusy.value = true; saveState.value = "saving"; clearError();
  try {
    const response = await api("/api/rooms/" + roomId + "/topology/import", { method: "POST", headers: { "x-session-id": sessionId.value, "x-topology-revision": String(lastRevision.value) }, body: JSON.stringify({ nodes: value.nodes, edges: value.edges }) });
    if (room.value?.id !== roomId) return false;
    applySync(response); return true;
  } catch (error) {
    if (error.body?.latest) applySync(error.body.latest);
    saveState.value = "error"; errorMessage.value = error.message; return false;
  } finally { mutationBusy.value = false; }
}
function openSettings() { clearError(); roomSettings.value = { name: room.value.name, description: room.value.description, accessMode: room.value.accessMode }; settingsOpen.value = true; }
async function generateRecoveryKey() {
  if (loading.value) return;
  loading.value = true; clearError();
  try { recoveryKey.value = (await api("/api/rooms/" + room.value.id + "/recovery", { method: "POST", headers: { "x-session-id": sessionId.value } })).recoveryKey; settingsOpen.value = false; }
  catch (error) { errorMessage.value = error.message; }
  finally { loading.value = false; }
}
async function deleteRoomConfirmed() {
  if (loading.value || participant.value?.role !== "owner") return;
  const roomId = room.value.id;
  loading.value = true; clearError();
  try { await api("/api/rooms/" + roomId, { method: "DELETE", headers: { "x-session-id": sessionId.value } }); deleteRoomOpen.value = false; if (room.value?.id === roomId) await leaveRoom(); }
  catch (error) { errorMessage.value = error.message; }
  finally { loading.value = false; }
}
async function readImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 1024 * 1024) { errorMessage.value = "ไฟล์นำเข้าต้องมีขนาดไม่เกิน 1 MB"; event.target.value = ""; return; }
  try { importText.value = await file.text(); }
  catch (error) { errorMessage.value = error.message; }
}
async function saveSettings() {
  if (loading.value) return;
  loading.value = true; clearError();
  try { const result = await api("/api/rooms/" + room.value.id, { method: "PATCH", headers: { "x-session-id": sessionId.value }, body: JSON.stringify(roomSettings.value) }); room.value = result.room; settingsOpen.value = false; setNotice("บันทึกการตั้งค่าห้องแล้ว"); }
  catch (error) { errorMessage.value = error.message; }
  finally { loading.value = false; }
}

const statusLabels = {
  online: "Online",
  offline: "Offline",
  warning: "Warning",
  unknown: "Unknown",
};
</script>

<template>
  <div class="app-shell" :class="{ 'editor-view': view === 'editor' }">
    <a class="skip-link" href="#main-content">ข้ามไปยังพื้นที่ทำงาน</a>
    <header class="topbar">
      <a class="brand-lockup brand-home-link" href="/" aria-label="NetAxis หน้าแรก" @click.prevent="goHome">
        <div class="brand-mark"><Network :size="20" /></div>
        <div><strong>NetAxis</strong><span>TOPOLOGY</span></div>
      </a>
      <div v-if="view === 'editor'" class="topbar-context">
        <strong :title="room?.name">{{ room?.name }}</strong
        ><button class="room-code room-code-button" title="คัดลอกรหัสเชิญเข้าห้อง" aria-label="คัดลอก Room code" @click="copyRoomCode"><span>{{ room?.joinCode }}</span><Copy :size="14" /></button
        ><span class="presence-strip"
          ><span class="presence-count"
            >{{
              participants.filter((item) => item.connected).length
            }}
            online</span
          ><span
            v-for="person in participants.filter(item => item.connected).slice(0, 4)"
            :key="person.id"
            class="presence-avatar"
            :title="`${person.displayName} · ${person.role}`"
            >{{ person.displayName.slice(0, 1).toUpperCase() }}</span
          ></span
        >
      </div>
      <div v-else-if="view === 'project'" class="topbar-context">
        <span class="eyebrow">PROJECT PRESET</span>
        <strong>{{ selectedPreset?.name }}</strong>
      </div>
      <div class="topbar-actions">
        <nav v-if="view === 'editor'" class="workspace-tabs" aria-label="พื้นที่ทำงาน">
          <button :aria-pressed="!plannerOpen && !simulationOpen" @click="openTopology"><Network :size="18" /> ผังเครือข่าย</button>
          <button :aria-pressed="plannerOpen" @click="!plannerOpen && togglePlanner()"><Calculator :size="18" /> วางแผน IP</button>
          <button title="เปิด Network Simulation" :aria-pressed="simulationOpen && !plannerOpen" @click="plannerOpen ? openSimulation() : toggleSimulation()"><Play :size="16" /> ทดสอบ / Scenario</button>
          <button :aria-pressed="ciscoOpen" @click="ciscoOpen = true"><Terminal :size="16" /> Cisco CLI</button>
          <button :aria-pressed="showTools" @click="showTools = !showTools"><Calculator :size="16" /> Subnet</button>
        </nav>
        <button v-if="view === 'editor'" class="quiet-button project-download" title="สำรอง Workspace JSON" :disabled="exportBusy" @click="exportJson"><Download :size="16" /> {{ exportBusy ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลดงาน' }}</button>
        <button v-if="account && view !== 'editor'" class="quiet-button account-logout" :disabled="loading" @click="logoutAccount" :title="account.email">ออกจากระบบ</button>
        <nav v-if="account && visitorVerified && view !== 'editor'" class="landing-nav" aria-label="เมนูหลัก">
          <a href="/" :aria-current="view === 'home' ? 'page' : undefined" @click.prevent="goHome">ภาพรวม</a>
          <a href="/workspace" :aria-current="view === 'rooms' ? 'page' : undefined" @click.prevent="openWorkspace">ห้องของฉัน</a>
          <a href="/#templates" :aria-current="['templates', 'project'].includes(view) ? 'page' : undefined" @click.prevent="openTemplates">Templates</a>
          <a href="/workspace#get-started" class="nav-create" @click.prevent="openWorkspace(); focusRoomForm()"><Plus :size="16" /> สร้างห้อง</a>
        </nav>
        <button v-if="view === 'editor'" class="community-toggle" :aria-expanded="communityOpen" aria-controls="room-community" @click="toggleCommunity">{{ communityOpen ? 'ปิดแชทและสมาชิก' : 'แชทและสมาชิก' }}<span v-if="unreadMessages" class="unread-badge" aria-label="ข้อความที่ยังไม่ได้อ่าน">{{ unreadMessages > 99 ? '99+' : unreadMessages }}</span></button>
        <button v-if="view === 'editor' && participant?.role === 'owner'" class="quiet-button room-settings-button" @click="openSettings">ตั้งค่าห้อง</button>
        <span v-if="view === 'editor' && roomTimeLabel" class="room-lifetime" :title="`หมดอายุ ${new Date(room.expiresAt).toLocaleString('th-TH')}`">◷ {{ roomTimeLabel }}</span>
        <span
          v-if="view === 'editor'"
          class="connection-pill"
          :data-state="connectionState"
          ><i></i>{{ connectionLabel }}</span
        ><button
          v-if="view === 'editor'"
          class="quiet-button"
          title="ออกจากห้อง"
          @click="leaveRoom"
        >
          ออกจากห้อง
        </button>
        <button
          v-if="view === 'project'"
          class="quiet-button"
          title="กลับหน้าแรก"
          @click="closePreset"
        >
          กลับหน้าแรก
        </button>
      </div>
    </header>

    <main v-if="booting" id="main-content" tabindex="-1" class="loading-page"><p role="status">กำลังโหลด workspace…</p></main>
    <main v-else-if="!visitorVerified" id="main-content" tabindex="-1" class="visitor-gate"><Shield :size="40" /><p class="eyebrow">NETWORK PLANNING & VERIFICATION</p><h1>เริ่มออกแบบเครือข่ายกับ NetAxis</h1><p>สร้างผัง วางแผน IP และทดสอบการเชื่อมต่อร่วมกับทีม<br />ยืนยันตัวเลขจากภาพก่อนเข้าสู่ระบบ</p><button class="primary-action compact" @click="visitorCaptchaOpen = true">ยืนยันและเริ่มใช้งาน <ArrowRight :size="18" /></button></main>
    <main v-else-if="!account" id="main-content" tabindex="-1" class="account-page"><AccountPanel :request="api" @authenticated="onAuthenticated" /></main>
    <main v-else-if="['home', 'rooms', 'templates'].includes(view)" id="main-content" tabindex="-1" class="room-landing" :class="view === 'home' ? 'landing-home' : 'workspace-page'">
      <div id="get-started" class="section-heading start-heading">
        <div><p class="eyebrow">{{ view === 'templates' ? 'TEMPLATE LIBRARY' : view === 'rooms' ? 'MY WORKSPACE' : 'NETWORK WORKSPACE' }}</p><h1>{{ view === 'templates' ? 'เริ่มจากเครือข่ายที่พร้อมใช้' : view === 'rooms' ? 'ห้องของฉัน' : 'พื้นที่ทำงานของคุณ' }}</h1><p class="workspace-intro">{{ view === 'templates' ? 'เลือก Lab เพื่อดูผังและ Scenario ก่อนสร้างห้องของคุณ' : view === 'rooms' ? 'เปิดงานต่อ สร้างห้องใหม่ หรือเข้าร่วมทีมด้วยรหัสเชิญ' : 'ออกแบบเครือข่าย วางแผน IP และตรวจสอบการเชื่อมต่อในที่เดียว' }}</p></div>
        <div class="start-actions"><button class="quiet-button" @click="startCreationTutorial">วิธีเริ่มต้น</button><a v-if="view !== 'templates'" class="primary-action compact" href="#new-room" @click.prevent="focusRoomForm()"><Plus :size="18" /> สร้างห้องใหม่</a></div>
      </div>
      <template v-if="['home', 'rooms'].includes(view)">
      <section id="workspaces" class="room-list" :aria-busy="roomsLoading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">MY ROOMS</p>
            <h2>{{ view === 'home' ? 'เปิดงานต่อ' : 'ห้องของฉัน' }} <span class="section-count">{{ visibleRooms.length }}</span></h2><p class="account-help">{{ account.email }} · ห้องเก็บไว้จนกว่าเจ้าของจะลบ</p>
          </div>
          <button
            class="icon-button"
            title="รีเฟรชรายการห้อง"
            aria-label="รีเฟรชรายการห้อง"
            :disabled="roomsLoading"
            @click="loadRooms"
          >
            ↻
          </button>
        </div>
        <label v-if="visibleRooms.length" class="room-search"><Search :size="18" aria-hidden="true" /><span class="sr-only">ค้นหาห้อง</span><input v-model="roomSearch" type="search" placeholder="ค้นหาชื่อห้อง คำอธิบาย หรือรหัสเชิญ" /></label>
        <div v-if="filteredRooms.length" class="room-table">
          <div v-for="item in filteredRooms" :key="item.id" class="room-row">
            <div class="room-avatar">
              {{ item.name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="room-row-main">
              <strong>{{ item.name }}</strong
              ><span>{{ item.description || "ไม่มีคำอธิบาย" }}</span><small class="room-lifetime">{{ roomTimeLeft(item, roomClock) }}</small>
            </div>
            <span class="room-row-code" :title="`รหัสเชิญ ${item.joinCode}`">{{ item.joinCode }}</span>
            <button class="quiet-button" :disabled="loading" @click="resumeRoom(item)">เปิดห้อง ↗</button>
          </div>
        </div>
        <div v-else-if="visibleRooms.length" class="empty-state" role="status"><p>ไม่พบห้องที่ตรงกับ “{{ roomSearch }}”</p><button class="quiet-button" @click="roomSearch = ''">ล้างคำค้น</button></div>
        <div v-else class="empty-state">
          <Network :size="28" aria-hidden="true" />
          <p>เริ่มเครือข่ายแรกของคุณ</p>
          <span>สร้างห้องใหม่ด้านล่าง หรือเลือก Template ที่ตั้งค่าไว้แล้ว</span><div class="empty-actions"><a href="#new-room" class="secondary-action compact" @click.prevent="focusRoomForm()">สร้างห้องใหม่ <ArrowRight :size="16" /></a><a href="/#templates" class="text-link" @click.prevent="openTemplates">ดู Templates</a></div>
        </div>
      </section>
      <section id="new-room" class="room-actions" aria-label="สร้างหรือเข้าร่วมห้อง">
        <form ref="createRoomPanel" class="form-panel create-room-panel" :aria-busy="loading" :class="{ 'creation-tour-active': createTutorialOpen }" @submit.prevent="createRoom">
          <div class="panel-heading">
            <span class="step-number"><Network :size="21" /></span>
            <div>
              <h2>สร้างห้องใหม่</h2>
              <p>เริ่มจากผังเปล่า · งานจะเก็บไว้ในบัญชีของคุณ</p>
            </div>
          </div>
          <section v-if="createTutorialOpen" class="creation-coach" aria-label="Tutorial สร้างห้อง" @keydown.esc.stop="closeCreationTutorial">
            <div class="creation-coach-heading"><span>ขั้นตอน {{ createTutorialStep + 1 }} / {{ creationSteps.length }}</span><button class="icon-button" type="button" aria-label="ปิด Tutorial" @click="closeCreationTutorial">×</button></div>
            <div class="creation-coach-content" aria-live="polite"><h3>{{ creationSteps[createTutorialStep].title }}</h3><p>{{ creationSteps[createTutorialStep].text }}</p></div>
            <div class="creation-coach-actions"><button v-if="createTutorialStep > 0" class="quiet-button" type="button" @click="changeCreationStep(createTutorialStep - 1)">ก่อนหน้า</button><button v-if="createTutorialStep < creationSteps.length - 1" class="secondary-action compact" type="button" :disabled="!canAdvanceTutorial" @click="changeCreationStep(createTutorialStep + 1)">ถัดไป →</button><span v-else>↓ กดปุ่มสร้างห้องที่ไฮไลต์ด้านล่าง</span></div>
          </section>
          <label
            data-tutorial-step="0" :class="{ 'tutorial-target': createTutorialOpen && createTutorialStep === 0 }"
            >ชื่อห้อง <span class="optional">มีชื่อเริ่มต้นให้แล้ว</span><input
              v-model="createForm.name"
              maxlength="100"
              placeholder="เช่น HQ Network 2026" /></label
          ><label
            data-tutorial-step="1" :class="{ 'tutorial-target': createTutorialOpen && createTutorialStep === 1 }"
            >ชื่อที่แสดง<input
              v-model="createForm.displayName"
              maxlength="60" required
              autocomplete="nickname"
              placeholder="ชื่อของคุณ" /></label
          ><details class="room-description"><summary>เพิ่มคำอธิบาย <span class="optional">ไม่บังคับ</span></summary><label
            >คำอธิบาย <span class="optional">ไม่บังคับ</span
            ><textarea
              v-model="createForm.description"
              rows="2" maxlength="500"
              placeholder="ขอบเขตหรือสถานที่ของระบบ"
            ></textarea></label></details
          ><label
            data-tutorial-step="2" :class="{ 'tutorial-target': createTutorialOpen && createTutorialStep === 2 }"
            >สิทธิ์เริ่มต้น<select v-model="createForm.accessMode">
              <option value="editor">ผู้เข้าร่วมแก้ไขได้</option>
              <option value="viewer">ผู้เข้าร่วมดูอย่างเดียว</option>
            </select></label
          ><button
            data-tutorial-step="3" :class="{ 'tutorial-target': createTutorialOpen && createTutorialStep === 3 }"
            class="primary-action"
            :disabled="loading || !createForm.displayName.trim()"
            type="submit"
          >
            {{ loading ? 'กำลังดำเนินการ…' : 'สร้างห้อง' }} <span>→</span>
          </button>
          <p v-if="!createForm.displayName.trim()" class="field-help">กรอกชื่อที่แสดงก่อนสร้างห้อง</p>
          <p v-if="createError" class="inline-error form-error" role="alert">{{ createError }}</p>
        </form>
        <form class="form-panel join-panel" :aria-busy="loading" @submit.prevent="joinRoom">
          <div class="panel-heading">
            <span class="step-number"><Cable :size="21" /></span>
            <div>
              <h2>เข้าร่วมห้อง</h2>
              <p>ใช้รหัสเชิญจากเจ้าของห้อง</p>
            </div>
          </div>
          <label
            >รหัสเชิญ · Room code<input
              v-model="joinForm.joinCode"
              placeholder="รหัสเชิญ 4 หลัก"
              maxlength="12" required autocomplete="off" spellcheck="false" aria-describedby="join-code-help"
              @input="
                joinForm.joinCode = joinForm.joinCode.toUpperCase().replace(/\s/g, '')
              " /></label
          ><p id="join-code-help" class="field-help">ขอรหัสตัวเลข 4 หลักจากเจ้าของห้อง</p><label
            >ชื่อที่แสดง<input
              v-model="joinForm.displayName"
              maxlength="60" required
              autocomplete="nickname"
              placeholder="ชื่อของคุณ" /></label
          ><label
            >บทบาท<select v-model="joinForm.role">
              <option value="editor">Editor · แก้ไขเครือข่ายได้</option>
              <option value="viewer">Viewer · ดูและแชทได้</option>
            </select></label
          ><details class="owner-recovery-field"><summary>กู้สิทธิ์เจ้าของห้อง</summary><label>รหัสกู้สิทธิ์<input v-model="joinForm.recoveryKey" type="password" maxlength="80" autocomplete="off" placeholder="ใช้เฉพาะเจ้าของห้อง" /></label></details><button
            class="secondary-action"
            :disabled="loading || !joinForm.joinCode.trim() || !joinForm.displayName.trim()"
            type="submit"
          >
            {{ loading ? 'กำลังเข้าร่วม…' : 'เข้าร่วมห้อง' }} <ArrowRight :size="16" />
          </button>
          <p v-if="!joinForm.joinCode.trim() || !joinForm.displayName.trim()" class="field-help">กรอกรหัสเชิญและชื่อที่แสดงก่อนเข้าร่วม</p>
          <p v-if="joinError" class="inline-error form-error" role="alert">{{ joinError }}</p>
        </form>
      </section>
      <section class="workspace-restore" aria-labelledby="restore-title"><div><p class="eyebrow">PROJECT FILE</p><h2 id="restore-title">กู้คืน Workspace จากไฟล์</h2><p>เปิดงานต่อในห้องใหม่ พร้อม Topology, แผน IPAM และ Simulator scenarios</p></div><label class="secondary-action restore-file-label">เลือกไฟล์ Workspace<input type="file" accept=".json,application/json" :disabled="loading" aria-label="Restore workspace file" @change="selectRestoreFile" /></label><div v-if="restoreFile" class="restore-preview"><strong>{{ restoreFile.room.name }}</strong><span>{{ restoreFile.nodes.length }} devices · {{ restoreFile.edges.length }} links · {{ restoreFile.plan?.segments?.length || 0 }} subnets</span><label>ชื่อที่แสดง<input v-model="restoreName" maxlength="60" autocomplete="nickname" /></label><button class="primary-action compact restore-workspace-action" :disabled="loading || !restoreName.trim()" @click="restoreWorkspace">กู้คืนเป็นห้องของฉัน</button></div></section>
      </template>
      <section id="templates" class="project-gallery">
        <div class="section-heading">
          <div>
            <p class="eyebrow">TEMPLATES</p>
            <h2>Cisco Labs พร้อมใช้งาน</h2><p class="account-help">ดูผังและการทดสอบตัวอย่าง แล้วใช้เป็นจุดเริ่มต้นของงาน</p>
          </div>
          <span class="project-count"
            >{{ presetProjects.length }} templates</span
          >
        </div>
        <div class="project-grid">
          <article
            v-for="preset in presetProjects"
            :key="preset.id"
            class="project-card"
            :class="`project-${preset.tone}`"
          >
            <div class="project-card-topline">
              <span class="project-status"><i></i> READY</span>
              <span>{{ preset.meta }}</span>
            </div>
            <div class="project-mini-topology">
              <svg :viewBox="templateViewBox(preset)" aria-hidden="true">
                <path
                  v-for="edge in preset.edges"
                  :key="edge.id"
                  :d="presetPath(preset, edge)"
                  class="preset-edge"
                />
                <g
                  v-for="node in preset.nodes"
                  :key="node.id"
                  :transform="`translate(${node.position.x} ${node.position.y})`"
                >
                  <rect width="144" height="68" rx="8" class="preset-node" />
                  <circle
                    cx="20"
                    cy="34"
                    r="7"
                    :class="`preset-dot preset-dot-${preset.tone}`"
                  />
                  <text x="35" y="39">{{ node.label.slice(0, 14) }}</text>
                </g>
              </svg>
            </div>
            <h3>{{ preset.name }}</h3>
            <p>{{ preset.description }}</p>
            <button
              type="button"
              class="secondary-action compact"
              @click.stop.prevent="openPreset(preset)"
            >
              ดู Template <ArrowRight :size="16" />
            </button>
          </article>
        </div>
      </section>
    </main>

    <main v-else-if="view === 'project' && selectedPreset" id="main-content" tabindex="-1" class="project-page">
      <a class="back-link" href="/#templates" @click.prevent="closePreset"><ChevronLeft :size="16" /> Templates</a>
      <section class="project-hero">
        <div>
          <p class="eyebrow">PROJECT PRESET · READY TO USE</p>
          <h1>{{ selectedPreset.name }}</h1>
          <p>{{ selectedPreset.description }}</p>
          <label class="preset-name-field">ชื่อที่แสดง<input v-model="createForm.displayName" maxlength="60" autocomplete="nickname" placeholder="ชื่อของคุณ" /></label>
          <p class="template-scope-note">ห้องผูกกับบัญชีและเก็บจนกว่าเจ้าของลบ · ดาวน์โหลดไฟล์สำรองได้</p>
          <div class="project-hero-actions">
            <button
              class="primary-action compact"
              :disabled="loading || !createForm.displayName"
              @click="createPresetRoom"
            >
              ใช้ Template นี้ <span>↗</span>
            </button>
            <button class="quiet-button" @click="closePreset">
              กลับหน้า Presets
            </button>
          </div>
        </div>
        <div class="project-metrics">
          <strong>{{ selectedPreset.nodes.length }}</strong
          ><span>devices</span>
          <strong>{{ selectedPreset.edges.length }}</strong
            ><span>connected links</span> <strong>READY</strong
          ><span>Realtime scenarios ready</span>
        </div>
      </section>
      <section class="template-use-guide">
        <div class="project-detail-list"><p class="eyebrow">READY TO RUN</p><h2>Realtime scenarios</h2><p>{{ selectedPreset.useCase }}</p><ul><li v-for="s in selectedPreset.scenarios" :key="s.id"><strong>{{ s.name }}</strong><span>{{ s.expected === 'failed' ? 'Expected Failed' : 'Expected Successful' }}</span></li></ul><p class="template-scope-note">มีทั้ง Successful และ Failed ที่คาดไว้ · เปิด CLI ตรวจ Config และดู packet บนผังได้</p></div>
        <div class="project-detail-list"><p class="eyebrow">PRESENTATION GUIDE</p><h2>ลำดับพรีเซนต์อาจารย์</h2><ol><li v-for="item in selectedPreset.checklist" :key="item">{{ item }}</li></ol><p class="template-scope-note">อุปกรณ์เป็นรุ่นจริง · Router/Switch ตั้ง Config ผ่าน Cisco CLI แล้ว · มีปุ่มนำเสนอเดโมในห้อง</p></div>
      </section>
      <section class="project-topology-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">CONNECTED TOPOLOGY</p>
            <h2>ภาพรวมการเชื่อมต่อ</h2>
          </div>
          <span class="project-count">{{ selectedPreset.meta }}</span>
        </div>
        <div class="project-topology-canvas">
          <svg :viewBox="templateViewBox(selectedPreset)" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern
                id="preset-grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="1" fill="#c4ccd8" />
              </pattern>
            </defs>
            <rect v-bind="templateBounds(selectedPreset)" fill="url(#preset-grid)" />
            <path
              v-for="edge in selectedPreset.edges"
              :key="edge.id"
              :d="presetPath(selectedPreset, edge)"
              class="preset-preview-edge"
              :data-medium="edge.medium"
            />
            <g
              v-for="node in selectedPreset.nodes"
              :key="node.id"
              :transform="`translate(${node.position.x} ${node.position.y})`"
              class="preset-preview-node"
            >
              <rect
                width="144"
                height="68"
                rx="8"
                class="node-shape"
                :class="`node-${deviceByType[node.type]?.tone || 'gray'}`"
              />
              <rect
                width="4"
                height="68"
                rx="2"
                class="node-accent"
                :class="`accent-${deviceByType[node.type]?.tone || 'gray'}`"
              />
              <component
                :is="deviceByType[node.type]?.icon || Box"
                class="node-device-icon"
                x="12"
                y="14"
                :size="28"
                :stroke-width="1.5"
              />
              <text class="node-type" x="48" y="20">
                {{ deviceByType[node.type]?.label || node.type }}
              </text>
              <title>{{ node.label }}</title><text class="node-label" x="48" y="42">{{ node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label }}</text>
              <circle
                class="node-status"
                cx="126"
                cy="18"
                r="5"
                :data-status="node.data?.status || 'unknown'"
              />
              <text class="node-ip" x="48" y="59">
                {{
                  node.data?.ipv4
                    ? `${node.data.ipv4}/${node.data.cidr ?? ""}`
                    : "No IPv4"
                }}
              </text>
            </g>
          </svg>
        </div>
      </section>
      <section class="project-details-grid">
        <div class="project-detail-list">
          <p class="eyebrow">DEVICES</p>
          <div
            v-for="node in selectedPreset.nodes"
            :key="node.id"
            class="project-detail-row"
          >
            <span
              class="mini-icon"
              :class="`tone-${deviceByType[node.type]?.tone || 'gray'}`"
              ><component :is="deviceByType[node.type]?.icon || Box" :size="15"
            /></span>
            <span
              ><strong>{{ node.label }}</strong
              ><small
                >{{ deviceByType[node.type]?.label }} ·
                {{ node.data?.ipv4 || "No IPv4" }}</small
              ></span
            >
            <i
              class="status-dot"
              :data-status="node.data?.status || 'unknown'"
            ></i>
          </div>
        </div>
        <div class="project-detail-list">
          <p class="eyebrow">LINKS</p>
          <div
            v-for="edge in selectedPreset.edges"
            :key="edge.id"
            class="project-detail-row link-row"
          >
            <span class="link-chip">↔</span>
            <span
              ><strong>{{ edge.label || "Connection" }}</strong
              ><small
                >{{ edge.medium }} · {{ edge.bandwidth || "Auto" }}</small
              ></span
            >
            <i
              class="status-dot"
              :data-status="edge.status === 'active' ? 'online' : 'unknown'"
            ></i>
          </div>
        </div>
      </section>
    </main>

    <PlanningWorkspace v-else-if="plannerOpen" ref="plannerPanel" :room-id="room.id" :session-id="sessionId" :role="participant?.role" :request="api" :nodes="topology.nodes" @close="plannerOpen = false" />
    <main v-else id="main-content" tabindex="-1" class="workspace" :class="{ 'simulation-layout': simulationOpen, 'presentation-layout': demoOpen && roomTemplate }">
      <div class="mobile-workspace-tools">
        <button class="mobile-tool" :aria-expanded="mobileLeftOpen" aria-controls="device-sidebar" @click="toggleMobilePanel('left')">
          เพิ่ม / หาอุปกรณ์</button
        ><button
          class="mobile-tool"
          :aria-expanded="mobileRightOpen" aria-controls="inspector-sidebar"
          @click="toggleMobilePanel('right')"
        >
          ตั้งค่าอุปกรณ์
        </button><button v-if="simulationOpen" class="mobile-tool" :aria-pressed="mobileDiagramVisible" @click="mobileDiagramVisible = !mobileDiagramVisible">{{ mobileDiagramVisible ? 'กลับไปทดสอบ' : 'ดูผัง' }}</button>
      </div>
      <aside
        class="sidebar left-sidebar"
        id="device-sidebar" :inert="compactWorkspace && !mobileLeftOpen ? true : undefined"
        @keydown.esc.stop="closeMobilePanel('left')"
        :class="{ 'mobile-open': mobileLeftOpen }"
      >
        <div class="mobile-panel-heading"><strong>อุปกรณ์บนผัง</strong><button class="icon-button" aria-label="ปิดรายการอุปกรณ์" @click="closeMobilePanel('left')"><X :size="18" /></button></div>
        <div class="sidebar-scroll">
          <div class="sidebar-block">
            <div class="sidebar-heading">
              <span>เพิ่มอุปกรณ์</span><small>ลากหรือคลิกเพื่อเพิ่ม</small>
            </div>
            <p v-if="participant?.role === 'viewer'" class="permission-note">ดูอย่างเดียว · เลือกอุปกรณ์และทดสอบได้</p>
            <div class="device-palette">
              <button
                v-for="device in deviceDefinitions.filter(d => ['router','switch','pc','server'].includes(d.type))"
                :key="device.type"
                class="device-tool"
                :class="`tone-${device.tone}`"
                :disabled="!canEdit"
                :draggable="canEdit"
                @dragstart="startPaletteDrag($event, device.type)"
                @click="addNode(device.type)"
              >
                <span class="device-icon"><DeviceGraphic :type="device.type" width="40" height="24" /></span
                ><span>{{ device.label }}</span
                ><b>+</b>
              </button>
            </div>
            <details class="extra-devices"><summary>อุปกรณ์อื่น ๆ</summary><div class="device-palette"><button v-for="device in deviceDefinitions.filter(d => !['router','switch','pc','server'].includes(d.type))" :key="device.type" class="device-tool" :disabled="!canEdit" :draggable="canEdit" @dragstart="startPaletteDrag($event, device.type)" @click="addNode(device.type)"><DeviceGraphic :type="device.type" width="40" height="24" /><span>{{ device.label }}</span></button></div></details>
          </div>
          <div class="sidebar-block search-block">
            <div class="sidebar-heading">
              <span
                >บนผัง <small>{{ topology.nodes.length }}</small></span
              >
            </div>
            <div class="search-input">
              <Search :size="16" aria-hidden="true" />
              <input v-model="search" aria-label="ค้นหาอุปกรณ์" placeholder="ค้นหาชื่อหรือ IP" />
            </div>
            <select v-model="filterStatus" class="filter-select" aria-label="กรองอุปกรณ์ตามสถานะ">
              <option value="all">ทุกสถานะ</option>
              <option
                v-for="(label, key) in statusLabels"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select>
            <div class="device-list">
              <button
                v-for="node in visibleNodes"
                :key="node.id"
                class="device-list-row"
                :class="{
                  active: selectedKind === 'node' && selectedId === node.id,
                }"
                @click="selectNode(node)"
              >
                <span
                  class="mini-icon"
                  :class="`tone-${deviceByType[node.type]?.tone || 'gray'}`"
                  ><component
                    :is="deviceByType[node.type]?.icon || Box"
                    :size="15"
                    :stroke-width="1.8" /></span
                ><span
                  ><strong>{{ node.label }}</strong
                  ><small>{{
                    node.data?.ipv4 || deviceByType[node.type]?.label
                  }}</small></span
                ><i
                  class="status-dot"
                  :data-status="node.data?.status || 'unknown'"
                ></i>
              </button>
              <div v-if="!visibleNodes.length" class="list-empty">
                {{ topology.nodes.length ? 'ไม่พบอุปกรณ์ที่ตรงกัน' : 'ยังไม่มีอุปกรณ์บนผัง' }}<button v-if="search || filterStatus !== 'all'" class="quiet-button" @click="search = ''; filterStatus = 'all'">ล้างตัวกรอง</button>
              </div>
            </div>
          </div>
        </div>
        <div class="sidebar-footer"><span class="access-badge">{{ participant?.role === 'owner' ? 'เจ้าของห้อง' : participant?.role === 'editor' ? 'แก้ไขได้' : 'ดูอย่างเดียว' }}</span>
          <small v-if="roomTimeLabel" class="sidebar-expiry">{{ roomTimeLabel }} · ดาวน์โหลดไฟล์ก่อนห้องหมดอายุ</small>
          <div class="revision-line">
            <span>เวอร์ชัน</span><strong>{{ lastRevision }}</strong>
          </div>
          <div class="save-line">
            <i :data-state="saveState"></i
            >{{
              saveState === "saving"
                ? "กำลังบันทึก"
                : saveState === "error"
                  ? "บันทึกไม่สำเร็จ"
                  : "บันทึกแล้ว"
            }}
          </div>
        </div>
      </aside>
      <section class="canvas-workspace">
        <div class="canvas-toolbar">
          <div v-if="connectionState !== 'connected' || saveState === 'error'" class="workspace-status-banner" role="status">{{ saveState === 'error' ? 'บันทึกไม่สำเร็จ · ตรวจการเชื่อมต่อก่อนแก้ไขต่อ' : 'กำลังเชื่อมต่อห้อง · การเปลี่ยนแปลงยังไม่ยืนยันว่าบันทึกแล้ว' }}</div>
          <div class="toolbar-group editor-tools" aria-label="เครื่องมือผัง">
            <button class="tool-button" :class="{ active: !connectMode }" :aria-pressed="!connectMode" @click="connectMode = false; pendingSource = null">เลือก / ย้าย</button>
            <button class="tool-button" :class="{ active: connectMode }" :aria-pressed="connectMode" :disabled="!canEdit" @click="connectMode = !connectMode; pendingSource = null"><Cable :size="16" /> ต่อสาย</button>
            <span class="toolbar-divider"></span>
            <button class="tool-button" title="Undo" aria-label="เลิกทำ" :disabled="!history.length || !canEdit" @click="undo">↶</button>
            <button class="tool-button" title="Redo" aria-label="ทำซ้ำ" :disabled="!future.length || !canEdit" @click="redo">↷</button>
          </div>
          <div class="toolbar-group toolbar-right"><button v-if="roomTemplate" class="tool-button demo-toggle" :aria-pressed="demoOpen" @click="demoOpen = !demoOpen">นำเสนอเดโม</button>
            <button class="tool-button" :disabled="!canEdit" @click="showImport = true"><Upload :size="16" /> นำเข้าผัง</button>
            <button class="tool-button" :aria-pressed="showVlans" @click="showVlans = !showVlans">VLAN</button>
            <button class="tool-button" :aria-pressed="validationOpen" @click="validationOpen = !validationOpen">ตรวจผัง <span class="issue-count" v-if="networkIssues.filter(i => i.severity === 'error').length">{{ networkIssues.filter(i => i.severity === 'error').length }}</span></button>

            <details class="workspace-menu"><summary aria-label="ไฟล์และเครื่องมือ">ไฟล์ <span>⌄</span></summary><div>
              <button title="นำเข้า topology JSON" :disabled="!canEdit" @click="showImport = true; $event.currentTarget.closest('details').open = false">นำเข้าผัง</button>
              <button title="ดาวน์โหลดจากเมนูไฟล์" :disabled="exportBusy" @click="exportJson(); $event.currentTarget.closest('details').open = false">{{ exportBusy ? 'กำลังบันทึก…' : 'ดาวน์โหลดโปรเจกต์' }}</button>
              <button @click="showTools = !showTools; $event.currentTarget.closest('details').open = false">คำนวณ Subnet / ส่งออกภาพ</button>
              <button v-if="participant?.role === 'owner'" class="mobile-room-action" @click="openSettings(); $event.currentTarget.closest('details').open = false">ตั้งค่าห้อง</button>
              <button class="mobile-room-action" @click="toggleCommunity(); $event.currentTarget.closest('details').open = false">แชทและสมาชิก</button>
              <button class="mobile-room-action" @click="leaveRoom()">ออกจากห้อง</button>
              <button v-if="account" :disabled="loading" :title="account.email" @click="logoutAccount">ออกจากระบบ</button>
            </div></details>
          </div>
        </div>
        <section v-if="roomTemplate && demoOpen" class="demo-guide" aria-label="คู่มือนำเสนอเดโม">
          <div class="demo-heading"><strong>{{ roomTemplate.name }}</strong><button class="quiet-button" @click="demoOpen = false" aria-label="ซ่อนคู่มือนำเสนอ">กลับไปแก้ไขผัง</button></div>
          <p>{{ demoStep + 1 }}/{{ roomTemplate.checklist.length }} · {{ roomTemplate.checklist[demoStep] }}</p>
          <div class="demo-actions"><button class="secondary-action" :disabled="demoStep === 0" @click="demoStep--">ก่อนหน้า</button><button class="secondary-action" :disabled="demoStep >= roomTemplate.checklist.length - 1" @click="demoStep++">ถัดไป</button><button class="secondary-action" @click="showDemoCli">ดู Cisco CLI</button><button class="quiet-button" @click="downloadDemoCli">ดาวน์โหลดคำสั่ง</button></div>
          <form class="demo-run" @submit.prevent="runDemoScenario"><label>เลือกการสาธิต<select v-model="demoScenario"><option v-for="s in roomTemplate.scenarios" :key="s.id" :value="s.id">{{ s.name }}</option></select></label><button class="primary-action" :disabled="!demoScenario">รันเดโมนี้</button></form>
          <p class="demo-scope">ผลคำนวณจาก Config ปัจจุบันใน Simulator · เป็นการจำลอง Cisco-style IPv4 ไม่ใช่ IOS หรืออุปกรณ์จริง</p>
        </section>
        <div
          ref="canvasStage"
          :class="{ 'has-simulator': simulationOpen, 'mobile-show-diagram': mobileDiagramVisible }"
          class="canvas-stage"
          @pointerdown="startPan"
          @pointermove="moveCanvasInteraction"
          @pointerup="handleStagePointerUp"
          @pointercancel="cancelCanvasInteraction"
          @dragover.prevent
          @drop.prevent="dropDevice"
          @wheel="zoomCanvas"
        >
          <div class="topology-viewport">
          <div v-if="showVlans" class="canvas-vlan-legend"><span v-for="vlan in [...new Set(topology.nodes.map(n => n.data?.vlan || '1'))]" :key="vlan" :style="{ color: vlanColor(vlan) }">VLAN {{ vlan }}</span></div>
          <svg
            ref="canvas"
            class="topology-svg"
            viewBox="0 0 1200 720"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern
                id="grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="1" fill="#c4ccd8" />
              </pattern>
              <filter
                id="node-shadow"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feDropShadow
                  dx="0"
                  dy="5"
                  stdDeviation="6"
                  flood-color="#000"
                  flood-opacity=".28"
                />
              </filter>
            </defs>
            <rect width="1200" height="720" fill="url(#grid)" />
            <g
              :transform="`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`"
            >
              <g
                v-for="edge in sortedEdges"
                :key="edge.id"
                class="edge-group"
                :class="{
                  selected: selectedKind === 'edge' && selectedId === edge.id,
                  simulated: isSimulationEdge(edge.id),
                }"
                @click.stop="selectEdge(edge)"
                tabindex="0"
                role="button"
                :aria-label="`เส้นเชื่อม ${edge.label || edge.id}`"
                @keydown.enter.prevent="selectEdge(edge)"
              >
                <path
                  class="edge-line"
                  :d="edgePath(edge)"
                  :data-medium="edge.medium"
                />
                <path class="edge-hit" :d="edgePath(edge)" />
                <g
                  v-if="edge.label || showVlans"
                  class="edge-label"
                  :transform="`translate(${edgeMidpoint(edge).x} ${edgeMidpoint(edge).y})`"
                >
                  <rect
                    :width="edgeLabelWidth(edge)"
                    :height="showVlans ? 36 : 22"
                    rx="4"
                    :x="-edgeLabelWidth(edge) / 2"
                    y="-11"
                  />
                  <text text-anchor="middle" :y="showVlans ? 1 : 4">{{ edgePortLabel(edge) }}</text><text v-if="showVlans" class="edge-vlan-label" text-anchor="middle" y="16">{{ edgeVlanLabel(edge) }}</text>
                </g>
              </g>
              <path v-if="linkDraft" class="link-preview" :d="draftPath()" />
              <g
                v-for="node in visibleNodes"
                :key="node.id"
                class="node-group"
                :class="{
                  selected: selectedKind === 'node' && selectedId === node.id,
                  pending: pendingSource === node.id,
                  'pdu-source': simulationPicking.source === node.id,
                }"
                :transform="`translate(${node.position.x} ${node.position.y})`"
                :data-node-id="node.id"
                role="group" :aria-label="node.label"
                @pointerdown.stop="startNodeDrag($event, node)"
                @pointermove.stop="moveCanvasInteraction"
                @pointerup.stop="finishNodePointerUp($event, node)"
                @pointercancel.stop="cancelCanvasInteraction"
                @click.stop="selectNode(node)"
              >
                <rect
                  class="node-shape"
                  tabindex="0" role="button" :aria-label="`เลือก ${node.label}`"
                  @keydown.enter.stop.prevent="selectNode(node)"
                  @keydown.space.stop.prevent="selectNode(node)"
                  width="144"
                  height="126"
                  rx="8"
                  filter="url(#node-shadow)"
                  :class="`node-${deviceByType[node.type]?.tone || 'gray'}`"
                />
                <DeviceGraphic :type="node.type" x="0" y="0" />
                <text class="node-type" x="72" y="75" text-anchor="middle">
                  {{ deviceByType[node.type]?.label || node.type }}
                </text>
                <text class="node-label" x="72" y="90" text-anchor="middle">{{ node.label }}</text>
                <g v-if="showVlans" class="node-vlan-badge"><rect x="6" y="110" width="132" height="18" rx="6" :fill="vlanColor(node.data?.vlan)" fill-opacity=".15" :stroke="vlanColor(node.data?.vlan)" /><text x="72" y="123" text-anchor="middle" :fill="vlanColor(node.data?.vlan)">VLAN {{ node.data?.vlan || 1 }} · L{{ modelFor(node).layer }} · {{ modelFor(node).count }}P</text></g>
                <text v-if="node.data?.job?.title" class="node-job-label" x="72" text-anchor="middle" :y="showVlans ? 143 : 126">{{ node.data.job.status === 'done' ? '✓' : '☐' }} {{ node.data.job.assigneeName || 'Unassigned' }}</text>
                <text v-if="node.editingBy" class="node-editor-tag" x="4" y="-8">{{ node.editingBy }} กำลังขยับ</text>
                <circle
                  class="node-status"
                  cx="132"
                  cy="8"
                  r="5"
                  :data-status="node.data?.status || 'unknown'"
                />
                <text class="node-ip" x="72" y="104" text-anchor="middle">
                  {{
                    node.data?.ipv4
                      ? `${node.data.ipv4}/${node.data.cidr ?? ""}`
                      : "No IPv4"
                  }}
                </text>
                <circle
                  class="node-port"
                  v-if="canEdit && !simulationPicking.phase"
                  cx="0"
                  cy="34"
                  r="5"
                  tabindex="0"
                  role="button"
                  :aria-label="`ลากสายจาก ${node.label} port ซ้าย`"
                  @pointerdown.stop="startLinkDrag($event, node, 'left')"
                  @pointerup.stop="finishLinkDrag($event, node, 'left')"
                  @keydown.enter.stop.prevent="connectPort(node, 'left')"
                  @keydown.space.stop.prevent="connectPort(node, 'left')"
                />
                <circle
                  class="node-port"
                  v-if="canEdit && !simulationPicking.phase"
                  cx="144"
                  cy="34"
                  r="5"
                  tabindex="0"
                  role="button"
                  :aria-label="`ลากสายจาก ${node.label} port ขวา`"
                  @pointerdown.stop="startLinkDrag($event, node, 'right')"
                  @pointerup.stop="finishLinkDrag($event, node, 'right')"
                  @keydown.enter.stop.prevent="connectPort(node, 'right')"
                  @keydown.space.stop.prevent="connectPort(node, 'right')"
                />
              </g>
              <g
                v-for="packet in simulationPackets.filter(
                  (item) => item.active,
                )"
                :key="packet.id"
                class="simulation-packet"
                :class="{ 'packet-failed': packet.failed }" :data-protocol="packet.protocol"
                role="button" tabindex="0" :aria-label="`ดู ${packet.protocol} PDU`"
                @pointerdown.stop @click.stop="simulationPanel?.inspectEvent(packet.eventId)"
                @keydown.enter.stop.prevent="simulationPanel?.inspectEvent(packet.eventId)"
                :transform="`translate(${packetPosition(packet)?.x || 0} ${packetPosition(packet)?.y || 0})`"
              >
                <circle r="16" class="packet-glow" />
                <rect x="-10" y="-7" width="20" height="14" rx="2" class="packet-core" />
                <path d="M-9 -6 L0 1 L9 -6" class="packet-envelope" />
                <text x="15" y="4">{{ packet.protocol }} · {{ packet.operation }}{{ packet.failed ? " ×" : "" }}</text>
              </g>
            </g>
          </svg>
          </div>
          <SimulatorPanel v-if="simulationOpen" ref="simulationPanel" :topology="topology" :reset-key="simulationEpoch" :topology-revision="lastRevision" :scenarios="roomTemplate?.scenarios || []" :initial-mode="roomTemplate?.mode || 'Simulation'" :shared="sharingSimulation" :room-playback="sharedSimulation" :participant="participant" :command-busy="simulationCommandBusy" @share-mode="sharingSimulation = $event" @room-command="roomSimulationCommand" @close="toggleSimulation" @packets="simulationPackets = $event" @picking="setPduPicking" />
          <div v-if="!topology.nodes.length" class="canvas-empty">
            <Network :size="32" />
            <h3>เริ่มวาง topology</h3>
            <p>เพิ่มอุปกรณ์ เลือกรุ่น แล้วต่อสายเพื่อเริ่มสร้างเครือข่าย</p><button class="primary-action compact" :disabled="!canEdit" @click="addNode('router')"><Plus :size="18" /> เพิ่ม Router</button>
          </div>
          <div v-if="simulationPicking.phase" class="canvas-hint">Simple PDU: {{ simulationPicking.phase === "source" ? "เลือกต้นทาง" : "เลือกปลายทาง" }} · Escape เพื่อยกเลิก</div>
          <div v-if="connectMode" class="canvas-hint">
            เลือกอุปกรณ์ต้นทาง แล้วเลือกอุปกรณ์ปลายทางเพื่อสร้างเส้นเชื่อม
          </div>
          <div class="canvas-legend"><span>{{ topology.nodes.length }} อุปกรณ์ · {{ topology.edges.length }} สาย</span><span class="canvas-shortcut">ลากพื้นหลังเพื่อเลื่อนผัง</span></div>
          <svg v-if="topology.nodes.length > 12" class="canvas-minimap" :viewBox="templateViewBox(topology)" role="button" tabindex="0" aria-label="ภาพรวมผัง คลิกเพื่อเลื่อน หรือใช้ปุ่มลูกศร" @keydown.left.prevent="camera.x += 100" @keydown.right.prevent="camera.x -= 100" @keydown.up.prevent="camera.y += 100" @keydown.down.prevent="camera.y -= 100" @keydown.enter.prevent="fitCanvas" @pointerdown.stop="locateOnMap"><path v-for="edge in topology.edges" :key="edge.id" :d="edgePath(edge)" /><rect v-for="node in topology.nodes" :key="node.id" :x="node.position.x" :y="node.position.y" width="144" height="68" /><rect class="minimap-viewport" :x="-camera.x / camera.zoom" :y="-camera.y / camera.zoom" :width="1200 / camera.zoom" :height="720 / camera.zoom" /></svg>
          <div class="canvas-zoom" aria-label="มุมมองผัง"><button aria-label="ลดการซูม" @click="zoomBy(-.2)">−</button><span>{{ Math.round(camera.zoom * 100) }}%</span><button aria-label="เพิ่มการซูม" @click="zoomBy(.2)">+</button><button aria-label="จัดผังให้พอดี" @click="fitCanvas">พอดี</button></div>
        </div>
      </section>
      <aside
        class="sidebar right-sidebar"
        id="inspector-sidebar" :inert="compactWorkspace && !mobileRightOpen ? true : undefined"
        @keydown.esc.stop="closeMobilePanel('right')"
        :class="{ 'mobile-open': mobileRightOpen }"
      >
        <div class="mobile-panel-heading"><strong>ตั้งค่าอุปกรณ์</strong><button class="icon-button" aria-label="ปิดการตั้งค่าอุปกรณ์" @click="closeMobilePanel('right')"><X :size="18" /></button></div>
        <div v-if="selected" class="properties-panel">
          <div class="properties-heading">
            <div>
              <p class="eyebrow">
                {{
                  selectedKind === "node"
                    ? "ตั้งค่าอุปกรณ์"
                    : "ตั้งค่าสาย"
                }}
              </p>
              <h2>
                {{
                  selectedKind === "node"
                    ? selected.label
                    : selected.label || "Connection"
                }}
              </h2>
            </div>
            <button
              type="button"
              class="delete-button"
              title="ลบรายการ"
              aria-label="ลบรายการที่เลือก"
              :disabled="!canEdit"
              @click.stop.prevent="confirmDelete"
            >
              <Trash2 :size="16" :stroke-width="1.8" />
            </button>
          </div>
          <p v-if="selectedKind === 'node'" class="device-overview">{{ selected.data?.ipv4 || 'ยังไม่มี IP' }} · VLAN {{ selected.data?.vlan || 1 }} · {{ statusLabels[selected.data?.status] || 'Unknown' }}</p>
          <template v-if="selectedKind === 'node'"
            ><div class="inspector-tabs" role="group" aria-label="ตั้งค่าอุปกรณ์"><button v-for="tab in [{id:'general',label:'ข้อมูล / IP'},{id:'ports',label:'พอร์ต'},{id:'security',label:'ACL / Services'},{id:'job',label:'งาน'}]" :key="tab.id" :aria-pressed="inspectorTab === tab.id" @click="inspectorTab = tab.id">{{ tab.label }}</button></div>
            <p v-if="participant?.role === 'viewer'" class="permission-note">ดูอย่างเดียว · เจ้าของห้องเปลี่ยนสิทธิ์ให้ได้</p>
            <div v-show="inspectorTab === 'general'" class="inspector-general"><label
              >ชื่ออุปกรณ์<input
                :value="selected.label"
                :disabled="!canEdit"
                @change="
                  mutate('node', 'update', {
                    ...selected,
                    label: $event.target.value,
                  })
                " /></label
            ><label
              >ชนิดอุปกรณ์<select
                :value="selected.type"
                :disabled="!canEdit"
                @change="
                  changeDeviceType($event.target.value)
                "
              >
                <option
                  v-for="item in deviceDefinitions"
                  :key="item.type"
                  :value="item.type"
                >
                  {{ item.label }}
                </option>
              </select></label
            >
            <button v-if="supportsCiscoCli(selected) || selected.type === 'pc'" class="utility-action device-cli-action" @click="ciscoOpen = true">เปิด CLI ของอุปกรณ์นี้ <span>→</span></button>

            <div class="field-row">
              <label
                >IPv4 address<input
                  :value="selected.data?.ipv4 || ''"
                  :disabled="!canEdit"
                  placeholder="192.168.1.10"
                  @change="
                    updateNodeField('ipv4', $event.target.value)
                  " /></label
              ><label
                >CIDR<input
                  type="number"
                  min="0"
                  max="32"
                  :value="selected.data?.cidr ?? ''"
                  :disabled="!canEdit"
                  placeholder="24"
                  @change="
                    updateNodeField(
                      'cidr',
                      $event.target.value
                        ? Number($event.target.value)
                        : undefined,
                    )
                  "
              /></label>
            </div>
            <DeviceLab :key="selected.id" :section="inspectorTab" :node="selected" :topology="topology" :writable="canEdit" :participants="participants" @data="mutate('node', 'update', { ...selected, data: $event })" />
            <details class="device-advanced"><summary>ข้อมูลเพิ่มเติม · IPv6 / MAC / หมายเหตุ</summary>
            <label
              >IPv6 prefix<input
                :value="selected.data?.ipv6 || ''"
                :disabled="!canEdit"
                placeholder="2001:db8::10/64"
                @change="updateNodeField('ipv6', $event.target.value)"
            /></label>
            <div class="field-row">
              <label
                >MAC address<input
                  :value="selected.data?.mac || ''"
                  :disabled="!canEdit"
                  placeholder="aa:bb:cc:dd:ee:ff"
                  @change="
                    updateNodeField('mac', $event.target.value)
                  " /></label
              ><label
                >VLAN ID<input
                  :value="selected.data?.vlan || ''"
                  :disabled="!canEdit || modelFor(selected).unmanaged"
                  placeholder="10"
                  @change="updateNodeField('vlan', $event.target.value)"
              /></label>
            </div>
            <label
              >สถานะ<select
                :value="selected.data?.status || 'unknown'"
                :disabled="!canEdit"
                @change="updateNodeField('status', $event.target.value)"
              >
                <option
                  v-for="(label, key) in statusLabels"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select></label
            ><label
              >ผู้ผลิต / รุ่น<input
                :value="selected.data?.vendor || ''"
                :disabled="!canEdit"
                placeholder="เช่น Cisco C9300"
                @change="
                  updateNodeField('vendor', $event.target.value)
                " /></label
            ><label
              >หมายเหตุ<textarea
                :value="selected.data?.notes || ''"
                :disabled="!canEdit"
                rows="3"
                placeholder="ข้อมูลเพิ่มเติม"
                @change="updateNodeField('notes', $event.target.value)"
              ></textarea></label
            ></details><button class="utility-action" @click="selectSubnetForNode">
              คำนวณ Subnet จาก Node <span>↗</span>
            </button></div>
            <DeviceLab v-if="inspectorTab !== 'general'" :key="selected.id" :section="inspectorTab" :node="selected" :topology="topology" :writable="canEdit" :participants="participants" @data="mutate('node', 'update', { ...selected, data: $event })" /></template
          ><template v-else
            ><label>Source port<select :value="selected.sourcePort || resolvedPorts(topology).find(e => e.id === selected.id)?.sourcePort" :disabled="!canEdit" @change="updateEdgeField('sourcePort', $event.target.value)"><option v-for="p in availablePorts(selected.sourceNodeId, selected.id)" :key="p.id" :value="p.id">{{ p.id }}</option></select></label><label>Target port<select :value="selected.targetPort || resolvedPorts(topology).find(e => e.id === selected.id)?.targetPort" :disabled="!canEdit" @change="updateEdgeField('targetPort', $event.target.value)"><option v-for="p in availablePorts(selected.targetNodeId, selected.id)" :key="p.id" :value="p.id">{{ p.id }}</option></select></label><label
              >Label<input
                :value="selected.label || ''"
                :disabled="!canEdit"
                @change="
                  updateEdgeField('label', $event.target.value)
                " /></label
            ><label
              >ชนิดสื่อ<select
                :value="selected.medium"
                :disabled="!canEdit"
                @change="updateEdgeField('medium', $event.target.value)"
              >
                <option value="ethernet">Ethernet</option>
                <option value="fiber">Fiber</option>
                <option value="wifi">Wi-Fi</option>
                <option value="generic">Generic</option>
              </select></label
            ><label
              >ความเร็ว<input
                :value="selected.bandwidth || ''"
                :disabled="!canEdit"
                placeholder="1 Gbps"
                @change="
                  updateEdgeField('bandwidth', $event.target.value)
                " /></label
            ><label
              >สถานะ<select
                :value="selected.status"
                :disabled="!canEdit"
                @change="updateEdgeField('status', $event.target.value)"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="unknown">Unknown</option>
              </select></label
            ><label
              >หมายเหตุ<textarea
                :value="selected.notes || ''"
                :disabled="!canEdit"
                rows="4"
                @change="updateEdgeField('notes', $event.target.value)"
              ></textarea></label
          ></template>
        </div>
        <div v-else class="no-selection"><h3>เริ่มจากอุปกรณ์บนผัง</h3><p>คลิกอุปกรณ์เพื่อแก้ IP, พอร์ต หรือเปิด CLI</p><ol><li>เพิ่มอุปกรณ์จากแถบซ้าย</li><li>กดต่อสาย แล้วเลือกอุปกรณ์สองตัว</li><li>เปิดทดสอบ / Scenario จากแถบหลัก</li></ol><button class="utility-action" @click="validationOpen = true">ตรวจสิ่งที่ต้องตั้งค่า</button></div>

      </aside>
    </main>

    <DevicePicker v-if="deviceDraft" :key="deviceDraft.type" :type="deviceDraft.type" :category="deviceByType[deviceDraft.type].label" :writable="canEdit" :load="() => api('/api/device-models')" :add="addSelectedDevice" @close="deviceDraft = null" />
    <DialogFrame v-if="showTools" title="คำนวณ Subnet และส่งออก" title-id="subnet-tools-title" @close="showTools = false">        <section class="network-tools">
          <div class="sidebar-heading">
            <span>SUBNET CALCULATOR</span><small>IPv4 utility</small>
          </div>
          <div class="field-row">
            <label
              >IP address<input
                v-model="subnetForm.ip"
                placeholder="10.0.0.1"
                @input="calculateSubnet" /></label
            ><label
              >CIDR<input
                v-model.number="subnetForm.cidr"
                type="number"
                min="0"
                max="32"
                @input="calculateSubnet"
            /></label>
          </div>
          <div v-if="subnetResult" class="subnet-result">
            <div>
              <span>Network</span><strong>{{ subnetResult.network }}</strong>
            </div>
            <div>
              <span>Broadcast</span
              ><strong>{{ subnetResult.broadcast }}</strong>
            </div>
            <div>
              <span>Mask</span><strong>{{ subnetResult.mask }}</strong>
            </div>
            <div>
              <span>Usable range</span
              ><strong
                >{{ subnetResult.first }} – {{ subnetResult.last }}</strong
              >
            </div>
            <div>
              <span>Usable hosts</span><strong>{{ subnetResult.hosts }}</strong>
            </div>
          </div>
          <p v-else class="field-help" :class="{ 'inline-error': subnetForm.ip }" role="status">{{ subnetForm.ip ? 'ตรวจสอบ IPv4 เช่น 10.0.0.1 และ CIDR ระหว่าง 0–32' : 'กรอก IPv4 และ CIDR เพื่อดูช่วง IP ที่ใช้งานได้' }}</p>
          <button class="utility-action" @click="exportCsv">
            ส่งออก Device CSV <span>⇡</span></button
          ><button class="utility-action" @click="exportPng">
            ส่งออก Canvas PNG <span>⇡</span>
          </button>
          <details :open="ipv6QuickOpen" @toggle="ipv6QuickOpen = $event.target.open"><summary>IPv6 calculator / planner</summary><Ipv6Planner :value="ipv6QuickPlan" @update="ipv6QuickPlan = $event" /><p>บันทึกแผน IPv6 ในหน้า Planning</p></details>
        </section></DialogFrame>
    <CiscoLab v-if="ciscoOpen && room && view === 'editor'" :key="room.id" :topology="topology" :writable="canEdit" :initial-node-id="selectedKind === 'node' ? selectedId : undefined" :save="node => mutate('node', 'update', node)" @close="ciscoOpen = false" @simulate="ciscoOpen = false; openSimulation()" />
    <DialogFrame v-if="connectionDraft" title="เชื่อมต่อ Port → Port" title-id="port-connection-title" @close="connectionDraft = null">
      <p>เลือกพอร์ตที่ว่างทั้งสองฝั่ง แล้วต่อสาย</p>
      <label>{{ topology.nodes.find(n => n.id === connectionDraft.sourceNodeId)?.label }}<select v-model="connectionDraft.sourcePort" aria-label="Source connection port"><option v-for="p in availablePorts(connectionDraft.sourceNodeId)" :key="p.id" :value="p.id">{{ p.id }} · {{ p.mode }} · VLAN {{ p.vlan }}</option></select></label>
      <label>{{ topology.nodes.find(n => n.id === connectionDraft.targetNodeId)?.label }}<select v-model="connectionDraft.targetPort" aria-label="Target connection port"><option v-for="p in availablePorts(connectionDraft.targetNodeId)" :key="p.id" :value="p.id">{{ p.id }} · {{ p.mode }} · VLAN {{ p.vlan }}</option></select></label>
      <label>ชนิดสาย<select v-model="connectionDraft.medium"><option value="ethernet">Ethernet</option><option value="fiber">Fiber</option><option value="wifi">Wi-Fi</option></select></label><p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
      <div class="modal-actions"><button class="quiet-button" @click="connectionDraft = null">ยกเลิก</button><button class="primary-action" :disabled="!canEdit || !connectionDraft.sourcePort || !connectionDraft.targetPort" @click="createConnection">ต่อสาย</button></div>
    </DialogFrame>
    <DialogFrame v-if="validationOpen" title="Network Validation" title-id="network-validation-title" @close="validationOpen = false">
      <p>{{ topology.nodes.length }} devices · {{ topology.edges.length }} links · {{ networkIssues.length }} issues</p><p>ตรวจ IP, Gateway, พอร์ตซ้ำ/เต็ม และ Access/Trunk VLAN · ทดสอบเส้นทางและ ACL ด้วย Simulator</p><p v-if="!networkIssues.length" class="stat-good">ผ่านการตรวจโครงสร้างและการตั้งค่าพื้นฐาน</p><ul class="validation-list"><li v-for="(issue, i) in networkIssues" :key="i"><button @click="selectedId = issue.nodeId || issue.edgeId; selectedKind = issue.nodeId ? 'node' : 'edge'; validationOpen = false; openMobileInspector()">{{ issue.severity.toUpperCase() }} · {{ issue.message }}</button></li></ul><button class="primary-action" @click="validationOpen = false; simulationOpen = true">ทดสอบ Ping / TCP / UDP / HTTP</button>
    </DialogFrame>
    <DialogFrame v-if="settingsOpen" class="room-settings-modal" title="ตั้งค่าห้อง" title-id="settings-title" @close="!loading && (settingsOpen = false)">
      <form @submit.prevent="saveSettings" :aria-busy="loading">
        <label>ชื่อห้อง<input v-model="roomSettings.name" maxlength="100" required :disabled="loading" /></label>
        <label>คำอธิบาย <span class="optional">ไม่บังคับ</span><textarea v-model="roomSettings.description" maxlength="500" rows="3" :disabled="loading"></textarea></label>
        <label>สิทธิ์ผู้เข้าร่วม<select v-model="roomSettings.accessMode" :disabled="loading"><option value="editor">แก้ไขได้</option><option value="viewer">ดูอย่างเดียว</option></select></label>
        <p class="modal-copy">เมื่อเปลี่ยนเป็นดูอย่างเดียว ผู้แก้ไขที่เข้าร่วมอยู่จะถูกลดสิทธิ์ทันที เจ้าของห้องยังแก้ไขได้</p>
        <button type="button" class="utility-action" :disabled="loading" @click="generateRecoveryKey">ออกรหัสกู้สิทธิ์เจ้าของห้องใหม่ <ArrowRight :size="16" /></button>
        <button type="button" class="delete-button settings-delete" :disabled="loading" @click="settingsOpen = false; clearError(); deleteRoomOpen = true">ลบห้องนี้</button>
        <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
        <div class="modal-actions"><button type="button" class="quiet-button" :disabled="loading" @click="settingsOpen = false">ยกเลิก</button><button class="primary-action compact" :disabled="loading">{{ loading ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า' }}</button></div>
      </form>
    </DialogFrame>
    <DialogFrame v-if="recoveryKey" title="รหัสกู้สิทธิ์เจ้าของห้อง" title-id="recovery-title" @close="recoveryKey = ''">
      <p class="modal-copy">เก็บรหัสนี้เป็นส่วนตัว ใช้ร่วมกับ Room code เพื่อกลับมาเป็นเจ้าของห้อง รหัสนี้จะแสดงครั้งเดียว และการออกรหัสใหม่จะยกเลิกรหัสเดิม</p>
      <input class="recovery-code" :value="recoveryKey" readonly aria-label="รหัสกู้สิทธิ์" @focus="$event.target.select()" />
      <div class="modal-actions"><button class="secondary-action compact" @click="download('netaxis-owner-key.txt', 'Room: ' + room.name + '\nRoom code: ' + room.joinCode + '\nRecovery key: ' + recoveryKey, 'text/plain;charset=utf-8')">ดาวน์โหลดรหัส</button><button class="primary-action compact" @click="recoveryKey = ''">เก็บรหัสแล้ว</button></div>
    </DialogFrame>
    <DialogFrame v-if="deleteRoomOpen" class="delete-confirm-modal" :title="`ลบห้อง ${room?.name}?`" title-id="delete-room-title" @close="!loading && (deleteRoomOpen = false)">
      <p class="modal-copy">ห้อง อุปกรณ์ และเส้นเชื่อมทั้งหมดจะถูกลบถาวร ผู้เข้าร่วมจะถูกนำออกจากห้อง การลบห้องไม่สามารถ Undo ได้</p>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div class="modal-actions"><button class="quiet-button" :disabled="loading" @click="deleteRoomOpen = false">ยกเลิก</button><button class="delete-confirm-action" :disabled="loading" @click="deleteRoomConfirmed">{{ loading ? 'กำลังลบ…' : 'ยืนยันลบห้อง' }}</button></div>
    </DialogFrame>
    <div v-if="errorMessage" class="toast toast-error" role="alert">
      <strong>ดำเนินการไม่สำเร็จ</strong><span>{{ errorMessage }}</span><button aria-label="ปิดข้อความผิดพลาด" @click="clearError"><X :size="18" /></button>
    </div>
    <div v-if="notice" class="toast toast-notice" role="status" aria-live="polite">
      <span>{{ notice }}</span><button aria-label="ปิดข้อความแจ้งเตือน" @click="notice = ''"><X :size="18" /></button>
    </div>
    <DialogFrame v-if="deleteTarget" class="delete-confirm-modal" :title="`ลบ${deleteTarget.kind === 'node' ? 'อุปกรณ์' : 'เส้นเชื่อม'}?`" title-id="delete-item-title" @close="cancelDelete">
      <p class="modal-copy">ยืนยันการลบ <strong>{{ deleteTarget.label }}</strong><span v-if="deleteTarget.kind === 'node'"> รวมถึงสายที่ต่อกับอุปกรณ์นี้</span> · ใช้ Undo เพื่อคืนรายการได้</p>
      <div class="modal-actions"><button type="button" class="quiet-button" @click="cancelDelete">ยกเลิก</button><button type="button" class="delete-confirm-action" :disabled="!canEdit" @click.stop.prevent="executeDelete">ลบรายการ</button></div>
    </DialogFrame>
    <DialogFrame v-if="showImport" title="นำเข้าผังจาก JSON" title-id="import-title" @close="showImport = false">
      <p id="import-help" class="modal-copy">เลือกไฟล์หรือวาง JSON ที่มี <code>{ nodes: [], edges: [] }</code> การนำเข้าจะแทนผังปัจจุบัน และสามารถ Undo ได้</p>
      <label class="import-file-label">เลือกไฟล์ JSON<input type="file" accept=".json,application/json" @change="readImportFile" /></label>
      <label>ข้อมูล JSON<textarea v-model="importText" rows="10" placeholder="วาง JSON ที่นี่" aria-describedby="import-help" spellcheck="false"></textarea></label>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div class="modal-actions"><button class="quiet-button" @click="showImport = false">ยกเลิก</button><button class="primary-action compact" :disabled="!canEdit || !importText.trim()" @click="importJson">ตรวจสอบและนำเข้า</button></div>
    </DialogFrame>

    <RoomCommunity v-if="view === 'editor'" v-show="communityOpen" id="room-community" :open="communityOpen" :key="room.id" :room-id="room.id" :participant="participant" :participants="participants" :messages="chatMessages" :connection-state="connectionState" :request="api" :collaboration="collaborationState" :send-collaboration="sendCollaboration" :jobs="topology.nodes.filter(n => n.data?.job?.title)" @close="communityOpen = false" @message="receiveRoomMessage" @status="participants = $event.participants" />
    <CaptchaDialog v-if="visitorCaptchaOpen" :request="api" :verify="verifyVisitorCaptcha" @close="visitorCaptchaOpen = false" />
  </div>
</template>
