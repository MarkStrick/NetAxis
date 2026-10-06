<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { io } from "socket.io-client";
import { startRoomSync } from './lib/room-sync.js';
import {
  Box,
  Cable,
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
} from "lucide-vue-next";

import { clone, csvCell } from "./lib/topology.js";
import { calculateSubnet as subnetDetails } from "../server/lib/subnet.js";
import PlanningWorkspace from "./PlanningWorkspace.vue";
import SimulatorPanel from "./SimulatorPanel.vue";
import { presetProjects } from "../shared/templates.js";
import { roomExpired, roomTimeLeft } from "../shared/room-lifetime.js";
const plannerOpen = ref(false);
const plannerPanel = ref(null);
function togglePlanner() { if (plannerOpen.value) plannerPanel.value?.requestClose(); else plannerOpen.value = true; }

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
  { type: "generic", label: "Generic Device", icon: Box, tone: "gray" },
];
const deviceByType = Object.fromEntries(
  deviceDefinitions.map((item) => [item.type, item]),
);

const view = ref("rooms");
const selectedPreset = ref(null);
const roomTemplate = ref(null);
const rooms = ref([]);
const room = ref(null);
const topology = ref({ nodes: [], edges: [] });
const participants = ref([]);
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
const showTools = ref(true);
const showImport = ref(false);
const restoreFile = ref(null);
const restoreName = ref('');
const exportBusy = ref(false);
const importText = ref("");
const createForm = ref({
  name: "",
  description: "",
  accessMode: "editor",
  displayName: localStorage.getItem("netaxis-name") || "",
});
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
const mobileRightOpen = ref(false);
const linkDraft = ref(null);
const canvasStage = ref(null);
const simulationOpen = ref(false);
const simulationPackets = ref([]);
const simulationEpoch = ref(0);
const simulationPanel = ref(null);
const simulationPicking = ref({ phase: "", source: "" });
const roomClock = ref(Date.now());
let roomClockTimer;
const roomTimeLabel = computed(() => roomTimeLeft(room.value, roomClock.value));
const visibleRooms = computed(() => rooms.value.filter(item => !roomExpired(item, roomClock.value)));

const selected = computed(() =>
  selectedKind.value === "node"
    ? topology.value.nodes.find((item) => item.id === selectedId.value) || null
    : topology.value.edges.find((item) => item.id === selectedId.value) || null,
);

const visibleNodes = computed(() =>
  topology.value.nodes.filter((node) => {
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
  view.value = "project";
}

function closePreset() {
  selectedPreset.value = null;
  view.value = "rooms";
}

function setNotice(message, timeout = 3500) {
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
  try {
    rooms.value = (await api("/api/rooms")).rooms;
  } catch (error) {
    errorMessage.value = error.message;
  }
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
      request: () => api(`/api/rooms/${id}/sync`, { method: 'POST', headers: { 'x-session-id': token }, body: JSON.stringify({ revision: lastRevision.value, tabId }) }),
      paused: () => mutationBusy.value || Boolean(drag.value) || saveState.value === 'saving',
      receive: payload => {
        if (room.value?.id !== id) return;
        connectionState.value = 'connected';
        participants.value = payload.participants || [];
        if (participant.value) participant.value.role = payload.participant.role;
        if (payload.topology && payload.room.revision > lastRevision.value && !mutationBusy.value && !drag.value) applySync(payload.topology);
        if (payload.room.revision === lastRevision.value) room.value = payload.room;
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
  currentSocket.on("connect", () => { connectionState.value = "connected"; });
  currentSocket.on("connect_error", (error) => {
    if (error.data?.code === 'ROOM_EXPIRED') { handleRoomExpired(); return; }
    connectionState.value = currentSocket.active ? "reconnecting" : "offline";
    if (!currentSocket.active) errorMessage.value = "Session หมดอายุ กรุณาออกจากห้องแล้วเข้าร่วมใหม่: " + error.message;
  });
  currentSocket.io.on("reconnect_attempt", () => { connectionState.value = "reconnecting"; });
  currentSocket.on("disconnect", () => { connectionState.value = "offline"; });
  currentSocket.on("room:sync", payload => {
    if (payload.room.revision >= lastRevision.value) applySync(payload);
  });
  currentSocket.on("room:presence", payload => {
    participants.value = payload.participants || [];
    const current = participants.value.find(person => person.id === participant.value?.id);
    if (current && participant.value) participant.value.role = current.role;
  });
  currentSocket.on("room:updated", payload => { room.value = payload.room; });
  currentSocket.on("session:ended", () => { resetEditor(); participant.value = null; room.value = null; view.value = "rooms"; bootstrap(); });
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
  clearError(); notice.value = ''; roomClock.value = Date.now();
  resetEditor();
  room.value = payload.room;
  sessionId.value = payload.sessionId;
  participant.value = payload.participant;
  rememberName(payload.participant.displayName);
  localStorage.removeItem("netaxis-session");
  localStorage.removeItem("netaxis-room");
  localStorage.removeItem("netaxis-participant");
  applySync(payload.topology);
  view.value = "editor";
  await nextTick();
  fitCanvas();
  wireSocket();
  if (payload.recoveryKey) recoveryKey.value = payload.recoveryKey;
}

async function createRoom() {
  if (loading.value) return;
  loading.value = true;
  try {
    clearError();
    const payload = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify(createForm.value),
    });
    await openRoom(payload);
  } catch (error) {
    errorMessage.value = error.message;
  } finally { loading.value = false; }
}

async function createPresetRoom() {
  if (!selectedPreset.value || loading.value) return;
  loading.value = true;
  try {
    clearError();
    const preset = selectedPreset.value;
    const payload = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        templateId: preset.id,
        name: `${preset.name} Project`,
        description: preset.description,
        accessMode: "editor",
        displayName: createForm.value.displayName,
      }),
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
  if (loading.value) return;
  loading.value = true;
  try {
    clearError();
    const payload = await api("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify(joinForm.value),
    });
    await openRoom(payload);
  } catch (error) {
    errorMessage.value = error.message;
  } finally { loading.value = false; }
}

async function rejoinSavedRoom() {
  try { await openRoom(await api("/api/session")); }
  catch (error) { if (error.status !== 401) errorMessage.value = error.message; }
}

function leaveRoom() { if (plannerOpen.value) plannerPanel.value?.requestClose(leaveRoomNow); else return leaveRoomNow(); }
async function leaveRoomNow() {
  resetEditor();
  room.value = null; participant.value = null;
  topology.value = { nodes: [], edges: [] };
  view.value = "rooms";
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
      mutate("edge", "create", {
        sourceNodeId: source,
        targetNodeId: node.id,
        label: "",
        medium: "ethernet",
        bandwidth: "",
        status: "unknown",
        notes: "",
      });
    }
    return;
  }
  selectedId.value = node.id;
  selectedKind.value = "node";
}

function selectEdge(edge) {
  if (connectMode.value) return;
  selectedId.value = edge.id;
  selectedKind.value = "edge";
}
function connectPort(node, side) {
  if (!canEdit.value) return;
  if (!pendingSource.value) { connectMode.value = true; pendingSource.value = node.id; pendingSourceSide.value = side; return; }
  if (pendingSource.value === node.id) return;
  const sourceNodeId = pendingSource.value, sourceSide = pendingSourceSide.value;
  pendingSource.value = null; pendingSourceSide.value = null; connectMode.value = false;
  mutate("edge", "create", { sourceNodeId, targetNodeId: node.id, sourceSide: sourceSide || "right", targetSide: side, medium: "ethernet", status: "unknown" });
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
  mutate("node", "create", { type, label: deviceByType[type].label, position: { x: position.x - 72, y: position.y - 34 }, data: { status: "unknown" } });
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
  mutate("edge", "create", {
    sourceNodeId: draft.sourceNodeId,
    targetNodeId: node.id,
    label: "",
    medium: "ethernet",
    bandwidth: "",
    status: "unknown",
    notes: "",
    sourceSide: draft.sourceSide,
    targetSide,
  });
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
  mutate("node", "create", {
    type,
    label: deviceByType[type].label,
    position: { x: center.x - 72, y: center.y - 34 },
    data: { status: "unknown" },
  });
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
    1.8,
    Math.max(0.45, camera.value.zoom * (event.deltaY > 0 ? 0.9 : 1.1)),
  );
  camera.value.zoom = nextZoom;
  camera.value.x = point.x - before.x * nextZoom;
  camera.value.y = point.y - before.y * nextZoom;
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
    const payload = await api('/api/rooms/restore', { method: 'POST', body: JSON.stringify({ displayName: restoreName.value, workspace: restoreFile.value }) });
    restoreFile.value = null; await openRoom(payload);
    simulationOpen.value = Boolean(payload.topology.template?.scenarios?.length);
    setNotice('กู้คืน Workspace แล้ว · ห้องใหม่มีอายุ 24 ชั่วโมง');
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
      const context = bitmap.getContext("2d"); context.fillStyle = "#0b1018"; context.fillRect(0, 0, 1600, 960); context.drawImage(image, 0, 0, 1600, 960);
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
  const start = nodePortPosition(source, sourceSide);
  const end = nodePortPosition(target, targetSide);
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
  if (plannerOpen.value) return;
  if (event.key === "Escape" && simulationPicking.value.phase) simulationPanel.value?.cancelPick();
  if (event.target.closest?.(".simulation-panel")) return;
  if (view.value !== "editor" || event.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
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

onMounted(async () => {
  window.addEventListener("keydown", handleKey);
  roomClockTimer = window.setInterval(() => {
    roomClock.value = Date.now();
    if (view.value === 'editor' && roomExpired(room.value, roomClock.value)) handleRoomExpired();
  }, 1000);
  await bootstrap();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKey);
  window.clearInterval(roomClockTimer);
  resetEditor();
});


function handleRoomExpired() {
  resetEditor(); room.value = null; participant.value = null;
  topology.value = { nodes: [], edges: [] }; view.value = 'rooms';
  setNotice('ห้องหมดอายุแล้ว · ห้องมีอายุ 24 ชั่วโมง สามารถสร้างห้องใหม่ได้', 0);
  loadRooms();
}
function resetEditor() {
  stopCloudSync?.(); stopCloudSync = null;
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
    await rejoinSavedRoom();
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
function openSettings() { roomSettings.value = { name: room.value.name, description: room.value.description, accessMode: room.value.accessMode }; settingsOpen.value = true; }
async function generateRecoveryKey() {
  try { recoveryKey.value = (await api("/api/rooms/" + room.value.id + "/recovery", { method: "POST", headers: { "x-session-id": sessionId.value } })).recoveryKey; settingsOpen.value = false; }
  catch (error) { errorMessage.value = error.message; }
}
async function deleteRoomConfirmed() {
  if (loading.value || participant.value?.role !== "owner") return;
  const roomId = room.value.id;
  loading.value = true;
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
  loading.value = true;
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
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">N</div>
        <div><strong>NetAxis</strong><span>TOPOLOGY</span></div>
      </div>
      <div v-if="view === 'editor'" class="topbar-context">
        <span class="eyebrow">ROOM</span><strong>{{ room?.name }}</strong
        ><span class="room-code">{{ room?.joinCode }}</span
        ><span class="presence-strip"
          ><span class="presence-count"
            >{{
              participants.filter((item) => item.connected).length
            }}
            online</span
          ><span
            v-for="person in participants.slice(0, 4)"
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
        <button v-if="view === 'editor'" class="tool-button planning-toggle" :aria-pressed="plannerOpen" @click="togglePlanner">{{ plannerOpen ? 'Topology' : 'IP Planning' }}</button>
        <nav v-if="view === 'rooms'" class="landing-nav" aria-label="เมนูหลัก">
          <a href="#workspaces">Workspace</a>
          <a href="#templates">Templates</a>
          <a href="#get-started" class="nav-create">สร้างห้อง <span>↗</span></a>
        </nav>
        <button v-if="view === 'editor' && participant?.role === 'owner'" class="quiet-button" @click="openSettings">ตั้งค่าห้อง</button>
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

    <main v-if="booting" class="loading-page"><p role="status">กำลังโหลด workspace…</p></main>
    <main v-else-if="view === 'rooms'" class="room-landing">
      <section class="landing-hero">
        <div class="room-intro">
          <p class="eyebrow">NETWORK PLANNING · DESIGN · LIVE VERIFICATION</p>
          <h1>วางแผนทุก IP<br /><em>ตรวจสอบทุกการเชื่อมต่อ</em></h1>
          <p class="intro-copy">วางแผน subnet/VLSM ออกแบบ topology และเปรียบเทียบการขยายเครือข่าย พร้อมใช้ Probe เทียบแผนกับอุปกรณ์ที่ตรวจพบจริงในแต่ละ site</p>
          <div class="hero-actions">
            <a href="#get-started" class="primary-action compact">เริ่มสร้างเครือข่าย <span>↗</span></a>
            <a href="#templates" class="hero-secondary">สำรวจ Templates <span>→</span></a>
          </div>
          <div class="trust-row">
            <span><b class="dot dot-green"></b> บันทึกบน Server</span>
            <span><b class="dot dot-blue"></b> ทำงานร่วมกัน</span>
            <span><b class="dot dot-amber"></b> ติดตาม Revision</span>
          </div>
        </div>
        <div class="hero-network" aria-label="ตัวอย่างการเชื่อมต่อเครือข่าย">
          <div class="hero-network-heading"><span><i class="dot dot-green"></i> NETWORK PREVIEW</span><span class="preview-badge">ตัวอย่าง</span></div>
          <svg viewBox="0 0 480 290" role="img" aria-label="Internet เชื่อมผ่าน Firewall และ Core Switch ไปยัง Server กับ Workstation">
            <defs><pattern id="hero-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#2b3b49" /></pattern></defs>
            <rect width="480" height="290" fill="url(#hero-dots)" />
            <g class="hero-wires"><path d="M100 145 H158 M238 145 H288 M368 145 H378 V65 H388 M378 145 V225 H388" /><circle cx="378" cy="145" r="4" /></g>
            <g transform="translate(30 111)" class="hero-diagram-node"><rect width="70" height="68" rx="14" /><Cloud x="23" y="11" :size="24" /><text x="35" y="51">Internet</text></g>
            <g transform="translate(158 104)" class="hero-diagram-node hero-node-mint"><rect width="80" height="82" rx="14" /><Shield x="27" y="13" :size="26" /><text x="40" y="58">Firewall</text><circle cx="69" cy="11" r="3" /></g>
            <g transform="translate(288 111)" class="hero-diagram-node"><rect width="80" height="68" rx="14" /><Network x="28" y="11" :size="24" /><text x="40" y="51">Core Switch</text></g>
            <g transform="translate(388 31)" class="hero-diagram-node"><rect width="70" height="68" rx="14" /><Server x="23" y="11" :size="24" /><text x="35" y="51">Server</text></g>
            <g transform="translate(388 191)" class="hero-diagram-node"><rect width="70" height="68" rx="14" /><Monitor x="23" y="11" :size="24" /><text x="35" y="51">Workstation</text></g>
            <g class="hero-flow"><circle cx="128" cy="145" r="4" /><circle cx="265" cy="145" r="4" /><circle cx="378" cy="93" r="4" /></g>
          </svg>
          <div class="hero-network-footer"><span><Network :size="14" /> 5 devices</span><span><Cable :size="14" /> 4 connections</span><span>Branch network</span></div>
        </div>
      </section>
      <div id="get-started" class="section-heading start-heading"><div><p class="eyebrow">LET’S BUILD SOMETHING</p><h2>พื้นที่ทำงานของคุณ</h2></div><span class="section-note">สร้างใหม่ หรือเข้าร่วมกับทีม</span></div>
      <section class="room-actions">
        <div class="form-panel">
          <div class="panel-heading">
            <span class="step-number"><Network :size="21" /></span>
            <div>
              <h2>สร้างห้องใหม่</h2>
              <p>เริ่ม workspace สำหรับ topology ของทีม · ห้องมีอายุ 24 ชั่วโมง</p>
            </div>
          </div>
          <label
            >ชื่อห้อง<input
              v-model="createForm.name"
              placeholder="เช่น HQ Network 2026" /></label
          ><label
            >ชื่อที่แสดง<input
              v-model="createForm.displayName"
              placeholder="ชื่อของคุณ" /></label
          ><label
            >คำอธิบาย <span class="optional">ไม่บังคับ</span
            ><textarea
              v-model="createForm.description"
              rows="2"
              placeholder="ขอบเขตหรือสถานที่ของระบบ"
            ></textarea></label
          ><label
            >สิทธิ์เริ่มต้น<select v-model="createForm.accessMode">
              <option value="editor">ผู้เข้าร่วมแก้ไขได้</option>
              <option value="viewer">ผู้เข้าร่วมดูอย่างเดียว</option>
            </select></label
          ><button
            class="primary-action"
            :disabled="loading || !createForm.name || !createForm.displayName"
            @click="createRoom"
          >
            สร้างห้อง <span>→</span>
          </button>
        </div>
        <div class="form-panel join-panel">
          <div class="panel-heading">
            <span class="step-number"><Cable :size="21" /></span>
            <div>
              <h2>เข้าร่วมห้อง</h2>
              <p>ใช้รหัสเชิญจากเจ้าของห้อง</p>
            </div>
          </div>
          <label
            >Room code<input
              v-model="joinForm.joinCode"
              placeholder="เช่น X7K2M9QP"
              maxlength="12"
              @input="
                joinForm.joinCode = joinForm.joinCode.toUpperCase()
              " /></label
          ><label
            >ชื่อที่แสดง<input
              v-model="joinForm.displayName"
              placeholder="ชื่อของคุณ" /></label
          ><label
            >บทบาท<select v-model="joinForm.role">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select></label
          ><details class="owner-recovery-field"><summary>กู้สิทธิ์เจ้าของห้อง</summary><label>รหัสกู้สิทธิ์<input v-model="joinForm.recoveryKey" type="password" maxlength="80" autocomplete="off" placeholder="ใช้เฉพาะเจ้าของห้อง" /></label></details><button
            class="secondary-action"
            :disabled="loading || !joinForm.joinCode || !joinForm.displayName"
            @click="joinRoom"
          >
            เข้าร่วมห้อง <span>↗</span>
          </button>
        </div>
      </section>
      <section id="workspaces" class="room-list">
        <div class="section-heading">
          <div>
            <p class="eyebrow">RECENT WORKSPACES</p>
            <h2>ห้องที่ใช้งานล่าสุด</h2>
          </div>
          <button
            class="icon-button"
            title="รีเฟรชรายการห้อง"
            @click="loadRooms"
          >
            ↻
          </button>
        </div>
        <div v-if="visibleRooms.length" class="room-table">
          <div v-for="item in visibleRooms" :key="item.id" class="room-row">
            <div class="room-avatar">
              {{ item.name.slice(0, 1).toUpperCase() }}
            </div>
            <div class="room-row-main">
              <strong>{{ item.name }}</strong
              ><span>{{ item.description || "ไม่มีคำอธิบาย" }}</span><small class="room-lifetime">{{ roomTimeLeft(item, roomClock) }}</small>
            </div>
            <span class="revision-tag">rev. {{ item.revision }}</span
            ><span class="room-row-code">{{ item.joinCode }}</span>
            <button class="quiet-button" :disabled="loading" @click="resumeRoom(item)">เปิดห้อง ↗</button>
          </div>
        </div>
        <div v-else class="empty-state">
          <span class="empty-icon">⌁</span>
          <p>ยังไม่มีห้องใน Server นี้</p>
          <span>สร้างห้องแรกเพื่อเริ่มวาง topology</span>
        </div>
      </section>
      <section class="workspace-restore" aria-labelledby="restore-title"><div><p class="eyebrow">CONTINUE YOUR WORK</p><h2 id="restore-title">กู้คืน Workspace จากไฟล์</h2><p>เปิดงานต่อในห้องใหม่ พร้อม Topology, แผน IPAM และ Simulator scenarios</p></div><label class="secondary-action restore-file-label">เลือกไฟล์ Workspace<input type="file" accept=".json,application/json" :disabled="loading" aria-label="Restore workspace file" @change="selectRestoreFile" /></label><div v-if="restoreFile" class="restore-preview"><strong>{{ restoreFile.room.name }}</strong><span>{{ restoreFile.nodes.length }} devices · {{ restoreFile.edges.length }} links · {{ restoreFile.plan?.segments?.length || 0 }} subnets</span><label>ชื่อที่แสดง<input v-model="restoreName" maxlength="60" autocomplete="nickname" /></label><button class="primary-action compact restore-workspace-action" :disabled="loading || !restoreName.trim()" @click="restoreWorkspace">กู้คืนเป็นห้องใหม่ · 24 ชั่วโมง</button></div></section>
      <section id="templates" class="project-gallery">
        <div class="section-heading">
          <div>
            <p class="eyebrow">PROJECT PRESETS</p>
            <h2>เริ่มต้นเร็วขึ้นด้วย Templates</h2>
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
              <svg viewBox="0 0 1200 720" aria-hidden="true">
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
              เปิด Project <span>→</span>
            </button>
          </article>
        </div>
      </section>
    </main>

    <main v-else-if="view === 'project' && selectedPreset" class="project-page">
      <section class="project-hero">
        <div>
          <p class="eyebrow">PROJECT PRESET · READY TO USE</p>
          <h1>{{ selectedPreset.name }}</h1>
          <p>{{ selectedPreset.description }}</p>
          <label class="preset-name-field">ชื่อที่แสดง<input v-model="createForm.displayName" maxlength="60" autocomplete="nickname" placeholder="ชื่อของคุณ" /></label>
          <p class="template-scope-note">ห้องที่สร้างมีอายุ 24 ชั่วโมงนับจากเวลาสร้าง · Export เพื่อเก็บแผนไว้ใช้ต่อ</p>
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
        <div class="project-detail-list"><p class="eyebrow">READY TO RUN</p><h2>Realtime scenarios</h2><p>{{ selectedPreset.useCase }}</p><ul><li v-for="s in selectedPreset.scenarios" :key="s.id"><strong>{{ s.name }}</strong><span>{{ s.expected === 'failed' ? 'Expected Failed' : 'Expected Successful' }}</span></li></ul><p class="template-scope-note">Realtime เล่น scenario ใน Simulator อัตโนมัติ · ตรวจ hardware จริงผ่าน IP Planning / Live Verify และ Probe</p></div>
        <div class="project-detail-list"><p class="eyebrow">DEPLOYMENT CHECKLIST</p><h2>นำไปใช้กับเครือข่ายจริง</h2><ol><li v-for="item in selectedPreset.checklist" :key="item">{{ item }}</li></ol><p class="template-scope-note">IPAM plan บันทึกให้แล้ว · แก้ IP ตัวอย่างและเติม MAC จริงก่อนใช้ผล Live Verify</p></div>
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
          <svg viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern
                id="preset-grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  stroke="#263247"
                  stroke-width="1"
                  opacity=".55"
                />
              </pattern>
            </defs>
            <rect width="1200" height="720" fill="url(#preset-grid)" />
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
    <main v-else class="workspace" :class="{ 'simulation-layout': simulationOpen }">
      <div class="mobile-workspace-tools">
        <button class="mobile-tool" @click="mobileLeftOpen = !mobileLeftOpen">
          อุปกรณ์</button
        ><button
          class="mobile-tool"
          @click="mobileRightOpen = !mobileRightOpen"
        >
          คุณสมบัติ
        </button>
      </div>
      <aside
        class="sidebar left-sidebar"
        :class="{ 'mobile-open': mobileLeftOpen }"
      >
        <div class="sidebar-scroll">
          <div class="sidebar-block">
            <div class="sidebar-heading">
              <span>DEVICE PALETTE</span><small>ลากหรือคลิกเพื่อเพิ่ม</small>
            </div>
            <div class="device-palette">
              <button
                v-for="device in deviceDefinitions"
                :key="device.type"
                class="device-tool"
                :class="`tone-${device.tone}`"
                :disabled="!canEdit"
                :draggable="canEdit"
                @dragstart="startPaletteDrag($event, device.type)"
                @click="addNode(device.type)"
              >
                <span class="device-icon"
                  ><component
                    :is="device.icon"
                    :size="18"
                    :stroke-width="1.7" /></span
                ><span>{{ device.label }}</span
                ><b>+</b>
              </button>
            </div>
          </div>
          <div class="sidebar-block search-block">
            <div class="sidebar-heading">
              <span
                >DEVICES <small>{{ topology.nodes.length }}</small></span
              >
            </div>
            <div class="search-input">
              <span>⌕</span
              ><input v-model="search" placeholder="ค้นหาอุปกรณ์" />
            </div>
            <select v-model="filterStatus" class="filter-select">
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
                ไม่พบอุปกรณ์ที่ตรงกัน
              </div>
            </div>
          </div>
        </div>
        <div class="sidebar-footer">
          <div class="revision-line">
            <span>REVISION</span><strong>{{ lastRevision }}</strong>
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
          <div class="toolbar-group">
            <button
              class="tool-button"
              :class="{ active: connectMode }"
              title="เชื่อมอุปกรณ์สองตัว"
              :disabled="!canEdit"
              @click="
                connectMode = !connectMode;
                pendingSource = null;
              "
            >
              ⌁
              <span>{{
                connectMode ? "เลือกปลายทาง" : "เชื่อมต่อ"
              }}</span></button
            ><button
              class="tool-button"
              title="จัด canvas ให้อยู่ในกรอบ"
              @click="fitCanvas"
            >
              ⌗ <span>จัดกรอบ</span></button
            ><button
              class="tool-button"
              :class="{ active: simulationOpen }"
              title="เปิด Network Simulation"
              @click="toggleSimulation"
            >
              <Cable :size="15" :stroke-width="1.8" />
              <span>Simulation</span>
            </button>
          </div>
          <div class="toolbar-group">
            <button
              class="tool-button"
              title="Undo"
              :disabled="!history.length || !canEdit"
              @click="undo"
            >
              ↶</button
            ><button
              class="tool-button"
              title="Redo"
              :disabled="!future.length || !canEdit"
              @click="redo"
            >
              ↷</button
            ><span class="toolbar-divider"></span
            ><button
              class="tool-button"
              title="ลดการซูม"
              @click="camera.zoom = Math.max(0.45, camera.zoom - 0.1)"
            >
              −</button
            ><span class="zoom-readout"
              >{{ Math.round(camera.zoom * 100) }}%</span
            ><button
              class="tool-button"
              title="เพิ่มการซูม"
              @click="camera.zoom = Math.min(1.8, camera.zoom + 0.1)"
            >
              +
            </button>
          </div>
          <div class="toolbar-group toolbar-right">
            <button
              class="tool-button"
              title="นำเข้า topology JSON"
              :disabled="!canEdit"
              @click="showImport = true"
            >
              ⇣ <span>Import</span></button
            ><button
              class="tool-button"
              title="สำรอง Workspace JSON" :disabled="exportBusy"
              @click="exportJson"
            >
              ⇡ <span>{{ exportBusy ? 'Exporting…' : 'Backup' }}</span></button
            ><button
              class="tool-button"
              title="เปิด/ปิด network tools"
              @click="showTools = !showTools"
            >
              ◫ <span>Tools</span>
            </button>
          </div>
        </div>
        <div
          ref="canvasStage"
          :class="{ 'has-simulator': simulationOpen }"
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
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  stroke="#263247"
                  stroke-width="1"
                  opacity=".55"
                />
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
                  v-if="edge.label"
                  class="edge-label"
                  :transform="`translate(${edgeMidpoint(edge).x} ${edgeMidpoint(edge).y})`"
                >
                  <rect
                    :width="Math.max(52, edge.label.length * 7 + 18)"
                    height="22"
                    rx="4"
                    :x="-Math.max(52, edge.label.length * 7 + 18) / 2"
                    y="-11"
                  />
                  <text text-anchor="middle" y="4">{{ edge.label }}</text>
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
                tabindex="0" role="button" :aria-label="`เลือก ${node.label}`"
                @keydown.enter.stop.prevent="selectNode(node)"
                @keydown.space.stop.prevent="selectNode(node)"
                @pointerdown.stop="startNodeDrag($event, node)"
                @pointermove.stop="moveCanvasInteraction"
                @pointerup.stop="finishNodePointerUp($event, node)"
                @pointercancel.stop="cancelCanvasInteraction"
                @click.stop="selectNode(node)"
              >
                <rect
                  class="node-shape"
                  width="144"
                  height="68"
                  rx="8"
                  filter="url(#node-shadow)"
                  :class="`node-${deviceByType[node.type]?.tone || 'gray'}`"
                />
                <rect
                  class="node-accent"
                  width="4"
                  height="68"
                  rx="2"
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
                <text class="node-label" x="48" y="42">{{ node.label }}</text>
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
                <text x="15" y="4">{{ packet.protocol }}{{ packet.failed ? " ×" : "" }}</text>
              </g>
            </g>
          </svg>
          </div>
          <SimulatorPanel v-if="simulationOpen" ref="simulationPanel" :topology="topology" :reset-key="simulationEpoch" :scenarios="roomTemplate?.scenarios || []" :initial-mode="roomTemplate?.mode || 'Simulation'" @close="toggleSimulation" @packets="simulationPackets = $event" @picking="setPduPicking" />
          <div v-if="!topology.nodes.length" class="canvas-empty">
            <span class="empty-icon">+</span>
            <h3>เริ่มวาง topology</h3>
            <p>เลือกอุปกรณ์จาก palette ทางซ้าย แล้วจัดวางบน canvas</p>
          </div>
          <div v-if="simulationPicking.phase" class="canvas-hint">Simple PDU: {{ simulationPicking.phase === "source" ? "เลือกต้นทาง" : "เลือกปลายทาง" }} · Escape เพื่อยกเลิก</div>
          <div v-if="connectMode" class="canvas-hint">
            เลือกอุปกรณ์ต้นทาง แล้วเลือกอุปกรณ์ปลายทางเพื่อสร้างเส้นเชื่อม
          </div>
          <div class="canvas-legend">
            <span><i class="legend-line"></i> User-defined link</span
            ><span><i class="legend-status"></i> User-defined status</span>
          </div>
        </div>
      </section>
      <aside
        class="sidebar right-sidebar"
        :class="{ 'mobile-open': mobileRightOpen }"
      >
        <div v-if="selected" class="properties-panel">
          <div class="properties-heading">
            <div>
              <p class="eyebrow">
                {{
                  selectedKind === "node"
                    ? "NODE PROPERTIES"
                    : "LINK PROPERTIES"
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
              :disabled="!canEdit"
              @click.stop.prevent="confirmDelete"
            >
              <Trash2 :size="16" :stroke-width="1.8" />
            </button>
          </div>
          <template v-if="selectedKind === 'node'"
            ><label
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
                  mutate('node', 'update', {
                    ...selected,
                    type: $event.target.value,
                  })
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
                  :disabled="!canEdit"
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
            ><button class="utility-action" @click="selectSubnetForNode">
              คำนวณ Subnet จาก Node <span>↗</span>
            </button></template
          ><template v-else
            ><label
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
        <div v-else class="no-selection">
          <span class="selection-icon">◌</span>
          <h3>ยังไม่ได้เลือก</h3>
          <p>เลือก Node หรือ Link บน canvas เพื่อดูรายละเอียด</p>
        </div>
        <section v-if="showTools" class="network-tools">
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
          <button class="utility-action" @click="exportCsv">
            ส่งออก Device CSV <span>⇡</span></button
          ><button class="utility-action" @click="exportPng">
            ส่งออก Canvas PNG <span>⇡</span>
          </button>
        </section>
      </aside>
    </main>

    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
      <form class="modal room-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" @submit.prevent="saveSettings">
        <div class="modal-heading"><h2 id="settings-title">ตั้งค่าห้อง</h2><button type="button" class="icon-button" aria-label="ปิด" @click="settingsOpen = false">×</button></div>
        <label>ชื่อห้อง<input v-model="roomSettings.name" maxlength="100" required /></label>
        <label>คำอธิบาย<textarea v-model="roomSettings.description" maxlength="500" rows="3"></textarea></label>
        <label>สิทธิ์ผู้เข้าร่วม<select v-model="roomSettings.accessMode"><option value="editor">แก้ไขได้</option><option value="viewer">ดูอย่างเดียว</option></select></label>
        <p class="modal-copy">เมื่อเปลี่ยนเป็นดูอย่างเดียว ผู้แก้ไขที่เข้าร่วมอยู่จะถูกลดสิทธิ์ทันที เจ้าของห้องยังแก้ไขได้</p>
        <button type="button" class="utility-action" @click="generateRecoveryKey">ออกรหัสกู้สิทธิ์เจ้าของห้องใหม่ <span>↗</span></button>
        <button type="button" class="delete-button settings-delete" @click="settingsOpen = false; deleteRoomOpen = true">ลบห้องนี้</button>
        <div class="modal-actions"><button type="button" class="quiet-button" @click="settingsOpen = false">ยกเลิก</button><button class="primary-action compact" :disabled="loading">บันทึก</button></div>
      </form>
    </div>
    <div v-if="recoveryKey" class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div class="modal-heading"><h2 id="recovery-title">รหัสกู้สิทธิ์เจ้าของห้อง</h2></div>
        <p class="modal-copy">เก็บรหัสนี้เป็นส่วนตัว ใช้ร่วมกับ Room code เพื่อกลับมาเป็นเจ้าของห้องบนเครื่องใหม่ หรือเมื่อ session หมดอายุ รหัสนี้จะแสดงครั้งเดียว และการออกรหัสใหม่จะยกเลิกรหัสเดิม</p>
        <input class="recovery-code" :value="recoveryKey" readonly aria-label="รหัสกู้สิทธิ์" @focus="$event.target.select()" />
        <div class="modal-actions"><button class="secondary-action compact" @click="download('netaxis-owner-key.txt', 'Room: ' + room.name + '\nRoom code: ' + room.joinCode + '\nRecovery key: ' + recoveryKey, 'text/plain;charset=utf-8')">ดาวน์โหลดรหัส</button><button class="primary-action compact" @click="recoveryKey = ''">เก็บรหัสแล้ว</button></div>
      </div>
    </div>
    <div v-if="deleteRoomOpen" class="modal-backdrop" @click.self="deleteRoomOpen = false">
      <div class="modal delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-room-title">
        <h2 id="delete-room-title">ลบห้อง {{ room?.name }}?</h2>
        <p class="modal-copy">ห้อง อุปกรณ์ และเส้นเชื่อมทั้งหมดจะถูกลบถาวร ผู้เข้าร่วมจะถูกนำออกจากห้อง การลบห้องไม่สามารถ Undo ได้</p>
        <div class="modal-actions"><button class="quiet-button" @click="deleteRoomOpen = false">ยกเลิก</button><button class="delete-confirm-action" :disabled="loading" @click="deleteRoomConfirmed">ยืนยันลบห้อง</button></div>
      </div>
    </div>
    <div v-if="errorMessage" class="toast toast-error" role="alert">
      <strong>ดำเนินการไม่สำเร็จ</strong><span>{{ errorMessage }}</span
      ><button @click="clearError">×</button>
    </div>
    <div v-if="notice" class="toast toast-notice">
      <span>{{ notice }}</span
      ><button @click="notice = ''">×</button>
    </div>
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="cancelDelete">
      <div class="modal delete-confirm-modal" role="dialog" aria-modal="true">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">DELETE TOPOLOGY ITEM</p>
            <h2>ลบ {{ deleteTarget.kind === "node" ? "อุปกรณ์" : "เส้นเชื่อม" }}?</h2>
          </div>
          <button type="button" class="icon-button" title="ยกเลิก" @click="cancelDelete">×</button>
        </div>
        <p class="modal-copy">
          ยืนยันการลบ <code>{{ deleteTarget.label }}</code>
          <span v-if="deleteTarget.kind === 'node'"> รวมถึงเส้นเชื่อมที่ต่อกับอุปกรณ์นี้</span>
          หรือไม่
        </p>
        <div class="modal-actions">
          <button type="button" class="quiet-button" @click="cancelDelete">ยกเลิก</button>
          <button type="button" class="delete-confirm-action" @click.stop.prevent="executeDelete">ลบรายการ</button>
        </div>
      </div>
    </div>
    <div
      v-if="showImport"
      class="modal-backdrop"
      @click.self="showImport = false"
    >
      <div class="modal">
        <div class="modal-heading">
          <div>
            <p class="eyebrow">IMPORT TOPOLOGY</p>
            <h2>นำเข้า JSON</h2>
          </div>
          <button class="icon-button" @click="showImport = false">×</button>
        </div>
        <p class="modal-copy">
          วาง JSON ที่มีรูปแบบ
          <code>{ nodes: [], edges: [] }</code> ระบบจะตรวจความสัมพันธ์ของ Edge
          ก่อนนำเข้าใน canvas การนำเข้าจะแทน topology ปัจจุบัน และสามารถ Undo ได้
        </p>
        <label class="import-file-label">เลือกไฟล์ JSON <input type="file" accept=".json,application/json" @change="readImportFile" /></label>
        <textarea
          v-model="importText"
          rows="14"
          placeholder="วาง JSON ที่นี่"
        ></textarea>
        <div class="modal-actions">
          <button class="quiet-button" @click="showImport = false">
            ยกเลิก</button
          ><button class="primary-action compact" :disabled="!canEdit" @click="importJson">
            ตรวจสอบและนำเข้า
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
