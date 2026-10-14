/* Cisco Real Sim — Copyright (c) 2026 Networkers Home. MIT; see LICENSE and README.md in this directory. */

// ../../../../../../private/tmp/netaxis-cisco-uuid.js
import { nanoid } from "nanoid";

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/topology/topologyEngine.ts
function generateMAC() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  }
  const hex = "0123456789ABCDEF";
  let mac = "";
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ":";
    mac += hex[Math.floor(Math.random() * 16)];
    mac += hex[Math.floor(Math.random() * 16)];
  }
  return mac;
}
function generateInterfaces(deviceType, deviceId) {
  const interfaces = [];
  if (deviceType === "router") {
    for (let i = 0; i < 4; i++) {
      interfaces.push({
        id: `${deviceId}-gi0/${i}`,
        name: `GigabitEthernet0/${i}`,
        ip: null,
        subnetMask: null,
        mac: generateMAC(),
        status: "administratively down",
        connectedTo: null,
        isShutdown: true,
        description: "",
        // Routers don't use switchport -- neutral defaults
        switchportMode: "access",
        accessVlan: 0,
        trunkVlans: [],
        nativeVlan: 0,
        // Subinterface fields
        isSubinterface: false,
        parentInterface: null,
        encapsulation: null,
        // IPv6 fields
        ipv6: null,
        ipv6PrefixLength: 64,
        ipv6LinkLocal: null,
        // Port Security (not applicable to routers)
        portSecurity: {
          enabled: false,
          maxMacAddresses: 1,
          violationMode: "shutdown",
          stickyMacEnabled: false,
          secureMacAddresses: [],
          violationCount: 0,
          errDisabled: false
        }
      });
    }
  } else if (deviceType === "switch") {
    for (let i = 0; i < 24; i++) {
      interfaces.push({
        id: `${deviceId}-fa0/${i}`,
        name: `FastEthernet0/${i}`,
        ip: null,
        subnetMask: null,
        mac: generateMAC(),
        status: "administratively down",
        connectedTo: null,
        isShutdown: true,
        description: "",
        // VLAN fields for switches
        switchportMode: "dynamic",
        accessVlan: 1,
        trunkVlans: [],
        nativeVlan: 1,
        // Subinterface fields
        isSubinterface: false,
        parentInterface: null,
        encapsulation: null,
        // IPv6 fields
        ipv6: null,
        ipv6PrefixLength: 64,
        ipv6LinkLocal: null,
        // Port Security
        portSecurity: {
          enabled: false,
          maxMacAddresses: 1,
          violationMode: "shutdown",
          stickyMacEnabled: false,
          secureMacAddresses: [],
          violationCount: 0,
          errDisabled: false
        }
      });
    }
  }
  return interfaces;
}
function createDevice(type, name, position) {
  const id = nanoid();
  const interfaces = generateInterfaces(type, id);
  const vlans = /* @__PURE__ */ new Map();
  const vlanDatabase = [];
  if (type === "switch") {
    const defaultVLAN = {
      id: 1,
      name: "default",
      interfaces: interfaces.map((i) => i.id)
    };
    vlans.set(1, defaultVLAN);
    vlanDatabase.push(defaultVLAN);
  }
  const device = {
    id,
    name,
    type,
    interfaces,
    position,
    macTable: /* @__PURE__ */ new Map(),
    arpTable: /* @__PURE__ */ new Map(),
    routingTable: [],
    isRunning: true,
    startupConfig: [],
    runningConfig: [],
    vlans,
    vlanDatabase,
    ospfProcess: null,
    ospfConfig: null,
    ipRouting: false,
    acls: /* @__PURE__ */ new Map(),
    aclApplications: /* @__PURE__ */ new Map(),
    natConfig: {
      insideInterfaces: /* @__PURE__ */ new Set(),
      outsideInterfaces: /* @__PURE__ */ new Set(),
      staticEntries: /* @__PURE__ */ new Map(),
      pools: /* @__PURE__ */ new Map(),
      translations: /* @__PURE__ */ new Map()
    },
    stpConfig: {
      enabled: true,
      mode: "pvst",
      vlanInstances: /* @__PURE__ */ new Map(),
      globalDefaults: {
        priority: 32768,
        maxAge: 20,
        helloTime: 2,
        forwardDelay: 15
      }
    },
    dhcpConfig: {
      enabled: true,
      pools: /* @__PURE__ */ new Map(),
      relayTargets: /* @__PURE__ */ new Map()
    }
  };
  return device;
}
function createTopology() {
  return {
    devices: /* @__PURE__ */ new Map(),
    links: /* @__PURE__ */ new Map(),
    version: 0
  };
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/cli/parser.ts
var COMMAND_DEFINITIONS = [
  // User EXEC mode commands
  {
    pattern: "enable",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["user"],
    action: () => ({ type: "ENABLE", params: {} }),
    description: "Enter privileged EXEC mode"
  },
  {
    pattern: "disable",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged", "config", "interface"],
    action: () => ({ type: "DISABLE", params: {} }),
    description: "Exit to user EXEC mode"
  },
  {
    pattern: "exit",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["user", "privileged", "config"],
    action: () => ({ type: "EXIT", params: {} }),
    description: "Exit current mode"
  },
  {
    pattern: "logout",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["user", "privileged"],
    action: () => ({ type: "LOGOUT", params: {} }),
    description: "Exit session"
  },
  {
    pattern: "help",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["user", "privileged", "config", "interface"],
    action: () => ({ type: "HELP", params: {} }),
    description: "Show help"
  },
  {
    pattern: "show version",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["user", "privileged"],
    action: () => ({ type: "SHOW_VERSION", params: {} }),
    description: "Show system version"
  },
  {
    pattern: "show running-config",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_RUNNING_CONFIG", params: {} }),
    description: "Show running configuration"
  },
  {
    pattern: "show startup-config",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_STARTUP_CONFIG", params: {} }),
    description: "Show startup configuration"
  },
  {
    pattern: "show ip interface brief",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_INTERFACE_BRIEF", params: {} }),
    description: "Show IP interface brief"
  },
  {
    pattern: "show ip interface",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_IP_INTERFACE", params: { interface: args[0] } }),
    description: "Show IP interface details"
  },
  {
    pattern: "show interfaces",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_INTERFACES", params: { interface: args[0] } }),
    description: "Show interface details"
  },
  {
    pattern: "show ip route",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_ROUTE", params: {} }),
    description: "Show IP routing table"
  },
  {
    pattern: "show arp",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_ARP", params: {} }),
    description: "Show ARP table"
  },
  {
    pattern: "show mac address-table",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_MAC_TABLE", params: {} }),
    description: "Show MAC address table"
  },
  {
    pattern: "show cdp neighbors",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_CDP_NEIGHBORS", params: {} }),
    description: "Show CDP neighbor entries"
  },
  {
    pattern: "ping",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "PING", params: { target: args[0] } }),
    description: "Ping a destination"
  },
  {
    pattern: "traceroute",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "TRACEROUTE", params: { target: args[0] } }),
    description: "Trace route to destination"
  },
  // Clear commands
  {
    pattern: "clear mac address-table dynamic",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "CLEAR_MAC_TABLE", params: {} }),
    description: "Clear dynamic MAC address table entries"
  },
  {
    pattern: "clear arp-cache",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "CLEAR_ARP_CACHE", params: {} }),
    description: "Clear ARP cache"
  },
  // Config mode commands
  {
    pattern: "configure terminal",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "CONFIGURE_TERMINAL", params: {} }),
    description: "Enter configuration mode"
  },
  {
    pattern: "hostname",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "HOSTNAME", params: { name: args[0] } }),
    description: "Set hostname"
  },
  {
    pattern: "enable secret",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "ENABLE_SECRET", params: { password: args[0] } }),
    description: "Set enable secret password"
  },
  {
    pattern: "enable password",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "ENABLE_PASSWORD", params: { password: args[0] } }),
    description: "Set enable password"
  },
  {
    pattern: "no enable secret",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config"],
    action: () => ({ type: "NO_ENABLE_SECRET", params: {} }),
    description: "Remove enable secret"
  },
  {
    pattern: "no enable password",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config"],
    action: () => ({ type: "NO_ENABLE_PASSWORD", params: {} }),
    description: "Remove enable password"
  },
  {
    pattern: "banner motd",
    minArgs: 1,
    maxArgs: 100,
    allowedModes: ["config"],
    action: (args) => ({ type: "BANNER_MOTD", params: { text: args.join(" ") } }),
    description: "Set message of the day banner"
  },
  {
    pattern: "no banner motd",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config"],
    action: () => ({ type: "NO_BANNER_MOTD", params: {} }),
    description: "Remove banner motd"
  },
  {
    pattern: "interface",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "INTERFACE", params: { interface: args[0] } }),
    description: "Enter interface configuration mode"
  },
  {
    pattern: "ip route",
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ["config"],
    action: (args) => ({
      type: "IP_ROUTE",
      params: { network: args[0], mask: args[1], nextHop: args[2] }
    }),
    description: "Add static route"
  },
  {
    pattern: "no ip route",
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ["config"],
    action: (args) => ({
      type: "NO_IP_ROUTE",
      params: { network: args[0], mask: args[1], nextHop: args[2] }
    }),
    description: "Remove static route"
  },
  {
    pattern: "end",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config", "interface"],
    action: () => ({ type: "END", params: {} }),
    description: "Exit to privileged EXEC mode"
  },
  // OSPF configuration (config mode)
  {
    pattern: "router ospf",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "ROUTER_OSPF", params: { processId: parseInt(args[0], 10) } }),
    description: "Configure OSPF routing process"
  },
  {
    pattern: "no router ospf",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config"],
    action: () => ({ type: "NO_ROUTER_OSPF", params: {} }),
    description: "Remove OSPF routing process"
  },
  // OSPF router configuration mode commands
  {
    pattern: "network",
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ["router"],
    action: (args) => ({
      type: "OSPF_NETWORK",
      params: { network: args[0], wildcard: args[1], area: args[2] }
    }),
    description: "Enable OSPF on network (network wildcard area)"
  },
  {
    pattern: "no network",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["router"],
    action: (args) => ({
      type: "NO_OSPF_NETWORK",
      params: { network: args[0], wildcard: args[1] }
    }),
    description: "Remove OSPF from network"
  },
  {
    pattern: "router-id",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["router"],
    action: (args) => ({ type: "OSPF_ROUTER_ID", params: { routerId: args[0] } }),
    description: "Set OSPF router ID"
  },
  {
    pattern: "passive-interface",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["router"],
    action: (args) => ({ type: "OSPF_PASSIVE_INTERFACE", params: { interface: args[0] } }),
    description: "Suppress OSPF hellos on interface"
  },
  {
    pattern: "no passive-interface",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["router"],
    action: (args) => ({ type: "NO_OSPF_PASSIVE_INTERFACE", params: { interface: args[0] } }),
    description: "Enable OSPF hellos on interface"
  },
  {
    pattern: "default-information originate",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["router"],
    action: () => ({ type: "OSPF_DEFAULT_ORIGINATE", params: {} }),
    description: "Distribute default route"
  },
  {
    pattern: "no default-information originate",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["router"],
    action: () => ({ type: "NO_OSPF_DEFAULT_ORIGINATE", params: {} }),
    description: "Stop distributing default route"
  },
  {
    pattern: "exit",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["router"],
    action: () => ({ type: "EXIT_ROUTER", params: {} }),
    description: "Exit router configuration mode"
  },
  // Layer 3 Switch configuration
  {
    pattern: "ip routing",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config"],
    action: () => ({ type: "IP_ROUTING", params: {} }),
    description: "Enable IP routing on Layer 3 switch"
  },
  {
    pattern: "no ip routing",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["config"],
    action: () => ({ type: "NO_IP_ROUTING", params: {} }),
    description: "Disable IP routing on Layer 3 switch"
  },
  // ACL configuration (config mode)
  {
    pattern: "access-list",
    minArgs: 3,
    maxArgs: 100,
    allowedModes: ["config"],
    action: (args) => ({
      type: "ACCESS_LIST",
      params: {
        number: args[0],
        action: args[1],
        remainder: args.slice(2)
      }
    }),
    description: "Configure numbered ACL (access-list num permit/deny ...)"
  },
  {
    pattern: "no access-list",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "NO_ACCESS_LIST", params: { number: args[0] } }),
    description: "Delete numbered ACL"
  },
  {
    pattern: "ip access-list standard",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "IP_ACCESS_LIST_STANDARD", params: { name: args[0] } }),
    description: "Create named standard ACL"
  },
  {
    pattern: "ip access-list extended",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "IP_ACCESS_LIST_EXTENDED", params: { name: args[0] } }),
    description: "Create named extended ACL"
  },
  {
    pattern: "no ip access-list",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["config"],
    action: (args) => ({ type: "NO_IP_ACCESS_LIST", params: { type: args[0], name: args[1] } }),
    description: "Delete named ACL"
  },
  // ACL mode commands (permit/deny rules inside named ACL)
  {
    pattern: "permit",
    minArgs: 1,
    maxArgs: 10,
    allowedModes: ["acl"],
    action: (args) => ({ type: "ACL_PERMIT", params: { args } }),
    description: "Add permit rule to ACL"
  },
  {
    pattern: "deny",
    minArgs: 1,
    maxArgs: 10,
    allowedModes: ["acl"],
    action: (args) => ({ type: "ACL_DENY", params: { args } }),
    description: "Add deny rule to ACL"
  },
  {
    pattern: "remark",
    minArgs: 1,
    maxArgs: 20,
    allowedModes: ["acl"],
    action: (args) => ({ type: "ACL_REMARK", params: { text: args.join(" ") } }),
    description: "Add remark to ACL"
  },
  {
    pattern: "exit",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["acl"],
    action: () => ({ type: "EXIT_ACL", params: {} }),
    description: "Exit ACL configuration mode"
  },
  // NAT configuration (config mode)
  {
    pattern: "ip nat inside source static",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["config"],
    action: (args) => ({ type: "IP_NAT_STATIC", params: { local: args[0], global: args[1] } }),
    description: "Configure static NAT"
  },
  {
    pattern: "no ip nat inside source static",
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ["config"],
    action: (args) => ({ type: "NO_IP_NAT_STATIC", params: { local: args[0], global: args[1] || void 0 } }),
    description: "Remove static NAT (local [global])"
  },
  {
    pattern: "ip nat pool",
    minArgs: 4,
    maxArgs: 4,
    allowedModes: ["config"],
    action: (args) => ({
      type: "IP_NAT_POOL",
      params: {
        name: args[0],
        start: args[1],
        end: args[2],
        netmask: args[3]
      }
    }),
    description: "Create NAT pool (ip nat pool name start end netmask)"
  },
  {
    pattern: "no ip nat pool",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "NO_IP_NAT_POOL", params: { name: args[0] } }),
    description: "Delete NAT pool"
  },
  {
    pattern: "ip nat inside source list",
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ["config"],
    action: (args) => ({
      type: "IP_NAT_DYNAMIC",
      params: {
        acl: args[0],
        pool: args[1],
        overload: args[2] === "overload"
      }
    }),
    description: "Configure dynamic NAT (ip nat inside source list acl pool overload)"
  },
  // STP configuration (config mode)
  {
    pattern: "spanning-tree vlan",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["config"],
    action: (args) => ({
      type: "SPANNING_TREE_VLAN_PRIORITY",
      params: { vlan: parseInt(args[0], 10), priority: parseInt(args[1], 10) }
    }),
    description: "Set STP priority for VLAN (spanning-tree vlan X priority Y)"
  },
  {
    pattern: "spanning-tree portfast",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SPANNING_TREE_PORTFAST", params: { edge: args[0] === "edge" } }),
    description: "Enable PortFast on interface"
  },
  {
    pattern: "no spanning-tree portfast",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_SPANNING_TREE_PORTFAST", params: {} }),
    description: "Disable PortFast on interface"
  },
  {
    pattern: "spanning-tree bpduguard enable",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SPANNING_TREE_BPDUGUARD", params: { enabled: true } }),
    description: "Enable BPDU Guard on interface"
  },
  {
    pattern: "no spanning-tree bpduguard",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SPANNING_TREE_BPDUGUARD", params: { enabled: false } }),
    description: "Disable BPDU Guard on interface"
  },
  {
    pattern: "spanning-tree cost",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SPANNING_TREE_COST", params: { cost: parseInt(args[0], 10) } }),
    description: "Set STP port cost"
  },
  // DHCP configuration (config mode)
  {
    pattern: "ip dhcp pool",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "IP_DHCP_POOL", params: { name: args[0] } }),
    description: "Create DHCP pool"
  },
  {
    pattern: "no ip dhcp pool",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "NO_IP_DHCP_POOL", params: { name: args[0] } }),
    description: "Delete DHCP pool"
  },
  {
    pattern: "network",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["dhcp"],
    action: (args) => ({ type: "DHCP_NETWORK", params: { network: args[0], mask: args[1] } }),
    description: "Set DHCP pool network (in DHCP config mode)"
  },
  {
    pattern: "default-router",
    minArgs: 1,
    maxArgs: 8,
    allowedModes: ["dhcp"],
    action: (args) => ({ type: "DHCP_DEFAULT_ROUTER", params: { routers: args } }),
    description: "Set default gateway for DHCP clients"
  },
  {
    pattern: "dns-server",
    minArgs: 1,
    maxArgs: 8,
    allowedModes: ["dhcp"],
    action: (args) => ({ type: "DHCP_DNS_SERVER", params: { servers: args } }),
    description: "Set DNS servers for DHCP clients"
  },
  {
    pattern: "domain-name",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["dhcp"],
    action: (args) => ({ type: "DHCP_DOMAIN_NAME", params: { name: args[0] } }),
    description: "Set domain name for DHCP clients"
  },
  {
    pattern: "lease",
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ["dhcp"],
    action: (args) => ({
      type: "DHCP_LEASE",
      params: {
        days: parseInt(args[0], 10),
        hours: parseInt(args[1], 10),
        minutes: parseInt(args[2], 10)
      }
    }),
    description: "Set lease time (days hours minutes)"
  },
  {
    pattern: "ip dhcp excluded-address",
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ["config"],
    action: (args) => ({
      type: "IP_DHCP_EXCLUDED",
      params: {
        low: args[0],
        high: args[1] || args[0]
      }
    }),
    description: "Exclude IP address(es) from DHCP pool"
  },
  {
    pattern: "no ip dhcp excluded-address",
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ["config"],
    action: (args) => ({
      type: "NO_IP_DHCP_EXCLUDED",
      params: {
        low: args[0],
        high: args[1] || args[0]
      }
    }),
    description: "Remove excluded IP address(es)"
  },
  {
    pattern: "ip helper-address",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "IP_HELPER_ADDRESS", params: { server: args[0] } }),
    description: "Configure DHCP relay on interface"
  },
  {
    pattern: "no ip helper-address",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_IP_HELPER_ADDRESS", params: {} }),
    description: "Remove DHCP relay from interface"
  },
  // VLAN configuration (config mode)
  {
    pattern: "vlan",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "VLAN_CREATE", params: { id: parseInt(args[0], 10) } }),
    description: "Create/enter VLAN configuration"
  },
  {
    pattern: "no vlan",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["config"],
    action: (args) => ({ type: "VLAN_DELETE", params: { id: parseInt(args[0], 10) } }),
    description: "Delete a VLAN"
  },
  // Show VLAN commands
  {
    pattern: "show vlan brief",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_VLAN_BRIEF", params: {} }),
    description: "Show VLAN summary"
  },
  {
    pattern: "show vlan",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_VLAN", params: {} }),
    description: "Show VLAN information"
  },
  {
    pattern: "show interfaces trunk",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_INTERFACES_TRUNK", params: {} }),
    description: "Show trunk interfaces"
  },
  // OSPF show commands
  {
    pattern: "show ip ospf neighbor",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_OSPF_NEIGHBOR", params: {} }),
    description: "Show OSPF neighbors"
  },
  {
    pattern: "show ip ospf interface",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_IP_OSPF_INTERFACE", params: { interface: args[0] } }),
    description: "Show OSPF interface status"
  },
  {
    pattern: "show ip ospf database",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_OSPF_DATABASE", params: {} }),
    description: "Show OSPF link-state database"
  },
  {
    pattern: "show ip ospf",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_OSPF", params: {} }),
    description: "Show OSPF process information"
  },
  {
    pattern: "show ip route ospf",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_ROUTE_OSPF", params: {} }),
    description: "Show OSPF routes"
  },
  // ACL show commands
  {
    pattern: "show access-lists",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_ACCESS_LISTS", params: { name: args[0] } }),
    description: "Show access lists"
  },
  {
    pattern: "show ip access-lists",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_IP_ACCESS_LISTS", params: { name: args[0] } }),
    description: "Show IP access lists"
  },
  // NAT show commands
  {
    pattern: "show ip nat translations",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_NAT_TRANSLATIONS", params: {} }),
    description: "Show NAT translation table"
  },
  {
    pattern: "show ip nat statistics",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_NAT_STATISTICS", params: {} }),
    description: "Show NAT statistics"
  },
  // STP show commands
  {
    pattern: "show spanning-tree",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_SPANNING_TREE", params: { vlan: args[0] ? parseInt(args[0], 10) : void 0 } }),
    description: "Show spanning-tree information"
  },
  {
    pattern: "show spanning-tree vlan",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_SPANNING_TREE_VLAN", params: { vlan: parseInt(args[0], 10) } }),
    description: "Show spanning-tree for specific VLAN"
  },
  {
    pattern: "show spanning-tree summary",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_SPANNING_TREE_SUMMARY", params: {} }),
    description: "Show spanning-tree summary"
  },
  // DHCP show commands
  {
    pattern: "show ip dhcp pool",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_DHCP_POOL", params: {} }),
    description: "Show DHCP pools"
  },
  {
    pattern: "show ip dhcp binding",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_DHCP_BINDING", params: {} }),
    description: "Show DHCP bindings"
  },
  {
    pattern: "show ip dhcp server statistics",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IP_DHCP_STATISTICS", params: {} }),
    description: "Show DHCP server statistics"
  },
  // Interface config commands
  {
    pattern: "ip address",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["interface"],
    action: (args) => ({
      type: "IP_ADDRESS",
      params: { ip: args[0], mask: args[1] }
    }),
    description: "Set IP address"
  },
  {
    pattern: "no ip address",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_IP_ADDRESS", params: {} }),
    description: "Remove IP address"
  },
  {
    pattern: "shutdown",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SHUTDOWN", params: {} }),
    description: "Administratively shutdown interface"
  },
  {
    pattern: "no shutdown",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_SHUTDOWN", params: {} }),
    description: "Enable interface"
  },
  {
    pattern: "description",
    minArgs: 1,
    maxArgs: 100,
    allowedModes: ["interface"],
    action: (args) => ({ type: "DESCRIPTION", params: { text: args.join(" ") } }),
    description: "Set interface description"
  },
  {
    pattern: "no description",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_DESCRIPTION", params: {} }),
    description: "Remove interface description"
  },
  // Switchport commands (interface mode, switches only)
  {
    pattern: "switchport mode access",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SWITCHPORT_MODE", params: { mode: "access" } }),
    description: "Set interface as access port"
  },
  {
    pattern: "switchport mode trunk",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SWITCHPORT_MODE", params: { mode: "trunk" } }),
    description: "Set interface as trunk port"
  },
  {
    pattern: "switchport access vlan",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SWITCHPORT_ACCESS_VLAN", params: { vlan: parseInt(args[0], 10) } }),
    description: "Assign access VLAN to port"
  },
  {
    pattern: "switchport trunk allowed vlan",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SWITCHPORT_TRUNK_ALLOWED", params: { vlans: args[0] } }),
    description: "Set allowed VLANs on trunk"
  },
  {
    pattern: "switchport trunk native vlan",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SWITCHPORT_TRUNK_NATIVE", params: { vlan: parseInt(args[0], 10) } }),
    description: "Set native VLAN on trunk"
  },
  // Subinterface commands (Router-on-a-Stick)
  {
    pattern: "encapsulation dot1q",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "ENCAPSULATION_DOT1Q", params: { vlan: parseInt(args[0], 10) } }),
    description: "Set 802.1Q encapsulation VLAN"
  },
  // ACL application on interface
  {
    pattern: "ip access-group",
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ["interface"],
    action: (args) => ({ type: "IP_ACCESS_GROUP", params: { acl: args[0], direction: args[1] } }),
    description: "Apply ACL to interface (in/out)"
  },
  {
    pattern: "no ip access-group",
    minArgs: 0,
    maxArgs: 2,
    allowedModes: ["interface"],
    action: (args) => ({ type: "NO_IP_ACCESS_GROUP", params: { acl: args[0] || void 0, direction: args[1] || void 0 } }),
    description: "Remove ACL from interface"
  },
  // NAT interface commands
  {
    pattern: "ip nat inside",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "IP_NAT_INSIDE", params: {} }),
    description: "Mark interface as NAT inside"
  },
  {
    pattern: "no ip nat inside",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_IP_NAT_INSIDE", params: {} }),
    description: "Remove NAT inside from interface"
  },
  {
    pattern: "ip nat outside",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "IP_NAT_OUTSIDE", params: {} }),
    description: "Mark interface as NAT outside"
  },
  {
    pattern: "no ip nat outside",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_IP_NAT_OUTSIDE", params: {} }),
    description: "Remove NAT outside from interface"
  },
  {
    pattern: "duplex",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "DUPLEX", params: { mode: args[0] } }),
    description: "Set duplex mode"
  },
  {
    pattern: "speed",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SPEED", params: { value: args[0] } }),
    description: "Set interface speed"
  },
  // OSPF interface commands
  {
    pattern: "ip ospf cost",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "IP_OSPF_COST", params: { cost: parseInt(args[0], 10) } }),
    description: "Set OSPF interface cost"
  },
  {
    pattern: "ip ospf priority",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "IP_OSPF_PRIORITY", params: { priority: parseInt(args[0], 10) } }),
    description: "Set OSPF interface priority (0-255)"
  },
  {
    pattern: "ip ospf hello-interval",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "IP_OSPF_HELLO_INTERVAL", params: { interval: parseInt(args[0], 10) } }),
    description: "Set OSPF hello interval in seconds"
  },
  {
    pattern: "ip ospf dead-interval",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "IP_OSPF_DEAD_INTERVAL", params: { interval: parseInt(args[0], 10) } }),
    description: "Set OSPF dead interval in seconds"
  },
  {
    pattern: "exit",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "EXIT_INTERFACE", params: {} }),
    description: "Exit interface configuration mode"
  },
  // IPv6 commands (interface mode)
  {
    pattern: "ipv6 address",
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ["interface"],
    action: (args) => ({
      type: "IPV6_ADDRESS",
      params: {
        address: args[0],
        prefixLength: parseInt(args[1], 10),
        eui64: args[2] === "eui-64"
      }
    }),
    description: "Set IPv6 address (ipv6 address address/prefix-length [eui-64])"
  },
  {
    pattern: "no ipv6 address",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_IPV6_ADDRESS", params: {} }),
    description: "Remove IPv6 address"
  },
  {
    pattern: "ipv6 enable",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "IPV6_ENABLE", params: {} }),
    description: "Enable IPv6 processing on interface"
  },
  {
    pattern: "no ipv6 enable",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "NO_IPV6_ENABLE", params: {} }),
    description: "Disable IPv6 processing on interface"
  },
  // IPv6 show commands
  {
    pattern: "show ipv6 interface brief",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IPV6_INTERFACE_BRIEF", params: {} }),
    description: "Show IPv6 interface brief"
  },
  {
    pattern: "show ipv6 interface",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_IPV6_INTERFACE", params: { interface: args[0] } }),
    description: "Show IPv6 interface details"
  },
  {
    pattern: "show ipv6 route",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_IPV6_ROUTE", params: {} }),
    description: "Show IPv6 routing table"
  },
  // IPv6 static routes
  {
    pattern: "ipv6 route",
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ["config"],
    action: (args) => ({
      type: "IPV6_ROUTE",
      params: {
        network: args[0],
        nextHop: args[1] === "null0" ? null : args[1],
        interface: args[2] || null
      }
    }),
    description: "Add IPv6 static route"
  },
  {
    pattern: "no ipv6 route",
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ["config"],
    action: (args) => ({
      type: "NO_IPV6_ROUTE",
      params: {
        network: args[0],
        nextHop: args[1] === "null0" ? null : args[1],
        interface: args[2] || null
      }
    }),
    description: "Remove IPv6 static route"
  },
  // Port Security commands (interface mode)
  {
    pattern: "switchport port-security",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SWITCHPORT_PORT_SECURITY", params: { enabled: true } }),
    description: "Enable port security"
  },
  {
    pattern: "no switchport port-security",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SWITCHPORT_PORT_SECURITY", params: { enabled: false } }),
    description: "Disable port security"
  },
  {
    pattern: "switchport port-security maximum",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SWITCHPORT_PORT_SECURITY_MAXIMUM", params: { max: parseInt(args[0], 10) } }),
    description: "Set maximum secure MAC addresses"
  },
  {
    pattern: "switchport port-security violation",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["interface"],
    action: (args) => ({ type: "SWITCHPORT_PORT_SECURITY_VIOLATION", params: { mode: args[0] } }),
    description: "Set violation mode (protect/restrict/shutdown)"
  },
  {
    pattern: "switchport port-security mac-address",
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ["interface"],
    action: (args) => ({
      type: "SWITCHPORT_PORT_SECURITY_MAC",
      params: {
        mac: args[0],
        vlan: args[1] ? parseInt(args[1], 10) : void 0
      }
    }),
    description: "Add secure MAC address"
  },
  {
    pattern: "no switchport port-security mac-address",
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ["interface"],
    action: (args) => ({
      type: "NO_SWITCHPORT_PORT_SECURITY_MAC",
      params: {
        mac: args[0],
        vlan: args[1] ? parseInt(args[1], 10) : void 0
      }
    }),
    description: "Remove secure MAC address"
  },
  {
    pattern: "switchport port-security mac-address sticky",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SWITCHPORT_PORT_SECURITY_STICKY", params: { enabled: true } }),
    description: "Enable sticky MAC learning"
  },
  {
    pattern: "no switchport port-security mac-address sticky",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["interface"],
    action: () => ({ type: "SWITCHPORT_PORT_SECURITY_STICKY", params: { enabled: false } }),
    description: "Disable sticky MAC learning"
  },
  // Port Security show commands
  {
    pattern: "show port-security",
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_PORT_SECURITY", params: { interface: args[0] } }),
    description: "Show port security status"
  },
  {
    pattern: "show port-security interface",
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ["privileged"],
    action: (args) => ({ type: "SHOW_PORT_SECURITY_INTERFACE", params: { interface: args[0] } }),
    description: "Show port security for interface"
  },
  {
    pattern: "show port-security address",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "SHOW_PORT_SECURITY_ADDRESS", params: {} }),
    description: "Show secure MAC addresses"
  },
  // File operations
  {
    pattern: "write memory",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "WRITE_MEMORY", params: {} }),
    description: "Save configuration to startup-config"
  },
  {
    pattern: "copy running-config startup-config",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "COPY_RUN_START", params: {} }),
    description: "Copy running-config to startup-config"
  },
  {
    pattern: "erase startup-config",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "ERASE_STARTUP", params: {} }),
    description: "Erase startup configuration"
  },
  {
    pattern: "reload",
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ["privileged"],
    action: () => ({ type: "RELOAD", params: {} }),
    description: "Reload the system"
  }
];
function createParserState() {
  return {
    mode: "user",
    configTarget: null,
    history: [],
    historyIndex: -1
  };
}
function getPrompt(state, hostname) {
  switch (state.mode) {
    case "user":
      return `${hostname}>`;
    case "privileged":
      return `${hostname}#`;
    case "config":
      return `${hostname}(config)#`;
    case "interface":
      return `${hostname}(config-if)#`;
    case "router":
      return `${hostname}(config-router)#`;
    case "acl":
      return `${hostname}(config-${state.configTarget?.startsWith("ext-") ? "ext" : "std"}-nacl)#`;
    case "dhcp":
      return `${hostname}(dhcp-config)#`;
    default:
      return `${hostname}>`;
  }
}
var MAX_INPUT_LENGTH = 1024;
var MAX_HISTORY_SIZE = 1e3;
var MAX_TOKEN_LENGTH = 256;
var ALLOWED_CHARS = /^[\x20-\x7E]*$/;
function tokenize(input) {
  if (input.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters`);
  }
  if (!ALLOWED_CHARS.test(input)) {
    throw new Error("Input contains invalid characters");
  }
  if (input.includes("(.)*") || input.includes("(.+)*") || input.includes("(.*)*")) {
    throw new Error("Invalid input pattern detected");
  }
  const trimmed = input.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    if (token.length > MAX_TOKEN_LENGTH) {
      throw new Error(`Token exceeds maximum length of ${MAX_TOKEN_LENGTH} characters`);
    }
  }
  return tokens;
}
function tokenMatches(inputToken, patternToken) {
  if (inputToken === patternToken) return true;
  if (inputToken.length > 0 && patternToken.toLowerCase().startsWith(inputToken.toLowerCase()) && inputToken.length < patternToken.length) {
    return true;
  }
  return false;
}
function matchCommand(tokens, definition, currentMode) {
  if (!definition.allowedModes.includes(currentMode)) {
    return false;
  }
  const patternTokens = definition.pattern.split(" ");
  if (tokens.length < patternTokens.length) {
    return false;
  }
  for (let i = 0; i < patternTokens.length; i++) {
    if (!tokenMatches(tokens[i], patternTokens[i])) {
      return false;
    }
  }
  const argCount = tokens.length - patternTokens.length;
  if (argCount < definition.minArgs || argCount > definition.maxArgs) {
    return false;
  }
  return true;
}
function findCommand(tokens, currentMode) {
  const matches = [];
  for (const def of COMMAND_DEFINITIONS) {
    if (matchCommand(tokens, def, currentMode)) {
      matches.push(def);
    }
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const exactMatch = matches.find((def) => {
    const patternTokens = def.pattern.split(" ");
    return patternTokens.every((pt, i) => tokens[i]?.toLowerCase() === pt.toLowerCase());
  });
  if (exactMatch) return exactMatch;
  return "ambiguous";
}
function parseCommand(input, state, hostname) {
  const trimmed = input.trim();
  if (trimmed === "") {
    return {
      success: true,
      command: "",
      args: [],
      mode: state.mode
    };
  }
  const isHelpRequest = trimmed.endsWith("?");
  const commandInput = isHelpRequest ? trimmed.slice(0, -1).trim() : trimmed;
  let tokens;
  try {
    tokens = tokenize(commandInput);
  } catch (error) {
    return {
      success: false,
      command: "",
      args: [],
      mode: state.mode,
      error: error instanceof Error ? `% ${error.message}` : "% Invalid input"
    };
  }
  if (isHelpRequest) {
    const helpOutput = getContextHelp(tokens, state.mode);
    return {
      success: true,
      command: "",
      args: [],
      mode: state.mode,
      action: {
        type: "HELP_CONTEXT",
        params: { output: helpOutput }
      }
    };
  }
  if ((state.mode === "config" || state.mode === "interface") && tokens.length > 0 && tokens[0].toLowerCase() === "do") {
    const doTokens = tokens.slice(1);
    if (doTokens.length === 0) {
      return {
        success: false,
        command: "do",
        args: [],
        mode: state.mode,
        error: "% Incomplete command."
      };
    }
    const doCommandDef = findCommand(doTokens, "privileged");
    if (doCommandDef === "ambiguous") {
      return {
        success: false,
        command: doTokens[0] || "",
        args: doTokens.slice(1),
        mode: state.mode,
        error: `% Ambiguous command:  "do ${doTokens.join(" ")}"`
      };
    }
    if (!doCommandDef) {
      return {
        success: false,
        command: doTokens[0] || "",
        args: doTokens.slice(1),
        mode: state.mode,
        error: `Invalid input detected at '^' marker.\r
do ${doTokens.join(" ")}\r
   ^`
      };
    }
    const doPatternTokens = doCommandDef.pattern.split(" ");
    const doArgs = doTokens.slice(doPatternTokens.length);
    const doAction = doCommandDef.action(doArgs);
    if (trimmed !== "" && state.history[state.history.length - 1] !== trimmed) {
      if (state.history.length >= MAX_HISTORY_SIZE) state.history.shift();
      state.history.push(trimmed);
    }
    state.historyIndex = state.history.length;
    return {
      success: true,
      command: doCommandDef.pattern,
      args: doArgs,
      mode: state.mode,
      action: doAction
    };
  }
  if (trimmed !== "" && state.history[state.history.length - 1] !== trimmed) {
    if (state.history.length >= MAX_HISTORY_SIZE) {
      state.history.shift();
    }
    state.history.push(trimmed);
  }
  state.historyIndex = state.history.length;
  const commandDef = findCommand(tokens, state.mode);
  if (commandDef === "ambiguous") {
    return {
      success: false,
      command: tokens[0] || "",
      args: tokens.slice(1),
      mode: state.mode,
      error: `% Ambiguous command:  "${trimmed}"`
    };
  }
  if (!commandDef) {
    return {
      success: false,
      command: tokens[0] || "",
      args: tokens.slice(1),
      mode: state.mode,
      error: `Invalid input detected at '^' marker.\r
${trimmed}\r
${"^".padStart((tokens[0]?.length || 0) + 1, " ")}`
    };
  }
  const patternTokens = commandDef.pattern.split(" ");
  const args = tokens.slice(patternTokens.length);
  const action = commandDef.action(args);
  return {
    success: true,
    command: commandDef.pattern,
    args,
    mode: state.mode,
    action
  };
}
function transitionMode(state, action, currentInterface) {
  let output = "";
  switch (action.type) {
    case "ENABLE":
      state.mode = "privileged";
      break;
    case "DISABLE":
      state.mode = "user";
      state.configTarget = null;
      break;
    case "CONFIGURE_TERMINAL":
      state.mode = "config";
      break;
    case "INTERFACE": {
      state.mode = "interface";
      const ifName = action.params.interface;
      const loMatch = ifName.match(/^[Ll]oopback\s*(\d+)$/);
      const vlanMatch = ifName.match(/^[Vv]lan\s*(\d+)$/);
      if (loMatch) {
        state.configTarget = `Loopback${loMatch[1]}`;
      } else if (vlanMatch) {
        state.configTarget = `Vlan${vlanMatch[1]}`;
      } else {
        state.configTarget = ifName;
      }
      break;
    }
    case "ROUTER_OSPF": {
      state.mode = "router";
      state.configTarget = `ospf-${action.params.processId}`;
      break;
    }
    case "IP_ACCESS_LIST_STANDARD":
    case "IP_ACCESS_LIST_EXTENDED": {
      state.mode = "acl";
      state.configTarget = action.params.name;
      break;
    }
    case "IP_DHCP_POOL": {
      state.mode = "dhcp";
      state.configTarget = action.params.name;
      break;
    }
    case "EXIT":
      if (state.mode === "interface") {
        state.mode = "config";
        state.configTarget = null;
      } else if (state.mode === "router") {
        state.mode = "config";
        state.configTarget = null;
      } else if (state.mode === "acl") {
        state.mode = "config";
        state.configTarget = null;
      } else if (state.mode === "dhcp") {
        state.mode = "config";
        state.configTarget = null;
      } else if (state.mode === "config") {
        state.mode = "privileged";
        state.configTarget = null;
      } else if (state.mode === "privileged") {
        state.mode = "user";
      }
      break;
    case "EXIT_INTERFACE":
      state.mode = "config";
      state.configTarget = null;
      break;
    case "EXIT_ROUTER":
      state.mode = "config";
      state.configTarget = null;
      break;
    case "EXIT_ACL":
      state.mode = "config";
      state.configTarget = null;
      break;
    case "END":
      state.mode = "privileged";
      state.configTarget = null;
      break;
  }
  return { newState: state, output };
}
function getAvailableCommands(mode) {
  const commands = [];
  for (const def of COMMAND_DEFINITIONS) {
    if (def.allowedModes.includes(mode) && !commands.includes(def.pattern)) {
      commands.push(def.pattern);
    }
  }
  return commands.sort();
}
function getContextHelp(tokens, mode) {
  const lines = [];
  const availableCommands = COMMAND_DEFINITIONS.filter(
    (def) => def.allowedModes.includes(mode)
  );
  if (tokens.length === 0) {
    lines.push("");
    const commands = availableCommands.map((def) => def.pattern);
    const uniqueCommands = [...new Set(commands)].sort();
    for (const cmd of uniqueCommands) {
      const def = COMMAND_DEFINITIONS.find((d) => d.pattern === cmd);
      lines.push(`  ${cmd.padEnd(30)} ${def?.description || ""}`);
    }
    lines.push("");
  } else {
    const partial = tokens.join(" ").toLowerCase();
    const matching = availableCommands.filter(
      (def) => def.pattern.toLowerCase().startsWith(partial)
    );
    if (matching.length === 0) {
      lines.push("% Unrecognized command");
    } else {
      lines.push("");
      for (const def of matching) {
        lines.push(`  ${def.pattern.padEnd(30)} ${def.description}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
function getCompletions(input, mode) {
  const trimmed = input.trim().toLowerCase();
  const commands = getAvailableCommands(mode);
  return commands.filter((cmd) => cmd.toLowerCase().startsWith(trimmed));
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/utils/security.ts
function sanitizeInput(str) {
  if (!str) return "";
  return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
}
function isValidIPv6(ip) {
  const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^([0-9a-fA-F]{1,4}:){0,6}::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
  const [addr] = ip.split("/");
  return ipv6Pattern.test(addr);
}
function isValidHostname(hostname) {
  const pattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
  return pattern.test(hostname) && !hostname.endsWith("-");
}
var LIMITS = {
  MAX_VLANS: 4094,
  MAX_INTERFACES: 256,
  MAX_ROUTES: 1e4,
  MAX_ACL_ENTRIES: 1e3,
  MAX_MAC_ADDRESSES: 1e3,
  MAX_DHCP_POOLS: 100,
  MAX_NAT_TRANSLATIONS: 1e4,
  HOSTNAME_MAX_LEN: 63,
  DESCRIPTION_MAX_LEN: 240,
  BANNER_MAX_LEN: 4096,
  CONFIG_LINE_MAX_LEN: 1024
};
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/utils/arpTable.ts
var DEFAULT_ARP_TIMEOUT_MS = 4 * 60 * 60 * 1e3;

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/acl/aclEngine.ts
var STANDARD_ACL_MIN = 1;
var STANDARD_ACL_MAX = 99;
var STANDARD_ACL_EXPANDED_MIN = 1300;
var STANDARD_ACL_EXPANDED_MAX = 1999;
var EXTENDED_ACL_MIN = 100;
var EXTENDED_ACL_MAX = 199;
var EXTENDED_ACL_EXPANDED_MIN = 2e3;
var EXTENDED_ACL_EXPANDED_MAX = 2699;
function isStandardACLNumber(num) {
  return num >= STANDARD_ACL_MIN && num <= STANDARD_ACL_MAX || num >= STANDARD_ACL_EXPANDED_MIN && num <= STANDARD_ACL_EXPANDED_MAX;
}
function isExtendedACLNumber(num) {
  return num >= EXTENDED_ACL_MIN && num <= EXTENDED_ACL_MAX || num >= EXTENDED_ACL_EXPANDED_MIN && num <= EXTENDED_ACL_EXPANDED_MAX;
}
function getACLType(name) {
  const num = parseInt(name, 10);
  if (!isNaN(num)) {
    if (isStandardACLNumber(num)) return "standard";
    if (isExtendedACLNumber(num)) return "extended";
  }
  return "standard";
}
function createACL(device, name, type) {
  if (device.acls.has(name)) {
    return null;
  }
  const acl = {
    name,
    type,
    entries: []
  };
  device.acls.set(name, acl);
  return acl;
}
function deleteACL(device, name) {
  for (const [ifaceName, app] of device.aclApplications) {
    if (app.aclName === name) {
      device.aclApplications.delete(ifaceName);
    }
  }
  return device.acls.delete(name);
}
function addACLEntry(device, aclName, entry) {
  const acl = device.acls.get(aclName);
  if (!acl) return false;
  let sequence = 10;
  if (acl.entries.length > 0) {
    const maxSeq = Math.max(...acl.entries.map((e) => e.sequence));
    sequence = maxSeq + 10;
  }
  const ace = {
    ...entry,
    sequence
  };
  acl.entries.push(ace);
  acl.entries.sort((a, b) => a.sequence - b.sequence);
  return true;
}
function applyACL(device, interfaceName, aclName, direction) {
  if (!device.acls.has(aclName)) return false;
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) return false;
  device.aclApplications.set(interfaceName, {
    aclName,
    direction
  });
  return true;
}
function removeACLApplication(device, interfaceName) {
  return device.aclApplications.delete(interfaceName);
}
function showACL(device, name) {
  if (device.acls.size === 0) {
    return "% No ACLs configured\n";
  }
  let output = "";
  const aclsToShow = name ? [device.acls.get(name)].filter(Boolean) : Array.from(device.acls.values());
  if (name && aclsToShow.length === 0) {
    return `% ACL ${name} not found
`;
  }
  for (const acl of aclsToShow) {
    output += `${acl.type === "standard" ? "Standard" : "Extended"} IP access list ${acl.name}
`;
    for (const entry of acl.entries) {
      output += `    ${entry.sequence} ${entry.action}`;
      if (entry.protocol && entry.protocol !== "ip") {
        output += ` ${entry.protocol}`;
      }
      if (entry.source === "any") {
        output += " any";
      } else if (entry.sourceWildcard === "0.0.0.0") {
        output += ` host ${entry.source}`;
      } else {
        output += ` ${entry.source} ${entry.sourceWildcard}`;
      }
      if (entry.destination) {
        if (entry.destination === "any") {
          output += " any";
        } else if (entry.destWildcard === "0.0.0.0") {
          output += ` host ${entry.destination}`;
        } else {
          output += ` ${entry.destination} ${entry.destWildcard}`;
        }
      }
      if (entry.destPort !== void 0 && entry.destPortOperator) {
        output += ` ${entry.destPortOperator} ${entry.destPort}`;
      }
      output += "\n";
    }
    output += "\n";
  }
  return output;
}
function isValidACLNumber(num) {
  return isStandardACLNumber(num) || isExtendedACLNumber(num);
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/utils/priorityQueue.ts
var PriorityQueue = class {
  constructor(compareFn) {
    this.heap = [];
    this.compare = compareFn;
  }
  /**
   * Get the size of the queue
   */
  size() {
    return this.heap.length;
  }
  /**
   * Check if queue is empty
   */
  isEmpty() {
    return this.heap.length === 0;
  }
  /**
   * Peek at the highest priority item without removing it
   */
  peek() {
    return this.heap[0];
  }
  /**
   * Add an item to the queue
   * Time complexity: O(log n)
   */
  enqueue(item) {
    this.heap.push(item);
    this.heapifyUp(this.heap.length - 1);
  }
  /**
   * Remove and return the highest priority item
   * Time complexity: O(log n)
   */
  dequeue() {
    if (this.heap.length === 0) return void 0;
    if (this.heap.length === 1) return this.heap.pop();
    const result = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.heapifyDown(0);
    return result;
  }
  /**
   * Clear all items from the queue
   */
  clear() {
    this.heap.length = 0;
  }
  /**
   * Get all items (for debugging/inspection)
   */
  toArray() {
    return [...this.heap];
  }
  /**
   * Heapify up from given index
   */
  heapifyUp(index) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.compare(this.heap[current], this.heap[parent]) >= 0) {
        break;
      }
      this.swap(current, parent);
      current = parent;
    }
  }
  /**
   * Heapify down from given index
   */
  heapifyDown(index) {
    let current = index;
    while (true) {
      let smallest = current;
      const left = 2 * current + 1;
      const right = 2 * current + 2;
      if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.heap.length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === current) break;
      this.swap(current, smallest);
      current = smallest;
    }
  }
  /**
   * Swap two elements in the heap
   */
  swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
};

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/simulation/simulationEngine.ts
var EventQueue = class {
  constructor() {
    this.processedCount = 0;
    this.queue = new PriorityQueue((a, b) => a.timestamp - b.timestamp);
  }
  enqueue(event) {
    this.queue.enqueue(event);
  }
  dequeue() {
    return this.queue.dequeue();
  }
  peek() {
    return this.queue.peek();
  }
  isEmpty() {
    return this.queue.isEmpty();
  }
  size() {
    return this.queue.size();
  }
  getProcessedCount() {
    return this.processedCount;
  }
  incrementProcessed() {
    this.processedCount++;
  }
};
function ipToLong(ip) {
  const parts = ip.split(".");
  return (parseInt(parts[0]) << 24 | parseInt(parts[1]) << 16 | parseInt(parts[2]) << 8 | parseInt(parts[3])) >>> 0;
}
function longToIP(long) {
  return `${long >>> 24 & 255}.${long >>> 16 & 255}.${long >>> 8 & 255}.${long & 255}`;
}
function applySubnetMask(ip, mask) {
  const ipLong = ipToLong(ip);
  const maskLong = ipToLong(mask);
  return longToIP(ipLong & maskLong);
}
function isSameNetwork(ip1, ip2, mask) {
  return applySubnetMask(ip1, mask) === applySubnetMask(ip2, mask);
}
function isValidIP(ip) {
  const pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (!pattern.test(ip)) return false;
  const parts = ip.split(".").map(Number);
  return parts.every((p) => p >= 0 && p <= 255);
}
function isValidMask(mask) {
  if (!isValidIP(mask)) return false;
  const long = ipToLong(mask);
  let foundZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = long >> i & 1;
    if (bit === 0) foundZero = true;
    if (bit === 1 && foundZero) return false;
  }
  return true;
}
function createICMPPacket(type, srcIP, dstIP, srcMAC, dstMAC, identifier = 1, sequenceNumber = 1, data = "abcdefghijklmnopqrstuvwabcdefghi") {
  const payload = {
    type,
    code: 0,
    identifier,
    sequenceNumber,
    data
  };
  return {
    id: nanoid(),
    srcIP,
    dstIP,
    srcMAC,
    dstMAC,
    protocol: "ICMP",
    payload,
    ttl: 64,
    timestamp: Date.now()
  };
}
function findRoute(device, dstIP) {
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && isSameNetwork(iface.ip, dstIP, iface.subnetMask)) {
      return {
        network: applySubnetMask(dstIP, iface.subnetMask),
        mask: iface.subnetMask,
        nextHop: null,
        interface: iface.name,
        protocol: "C",
        metric: 0,
        isLocal: true,
        isIPv6: false
      };
    }
  }
  let bestRoute = null;
  let longestPrefix = -1;
  for (const route of device.routingTable) {
    if (isSameNetwork(dstIP, route.network, route.mask)) {
      const prefixLength = ipToLong(route.mask).toString(2).replace(/0/g, "").length;
      if (prefixLength > longestPrefix) {
        longestPrefix = prefixLength;
        bestRoute = route;
      }
    }
  }
  return bestRoute;
}
function addConnectedRoutes(device) {
  device.routingTable = device.routingTable.filter((r) => r.protocol !== "C");
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && !iface.isShutdown) {
      const network = applySubnetMask(iface.ip, iface.subnetMask);
      device.routingTable.push({
        network,
        mask: iface.subnetMask,
        nextHop: null,
        interface: iface.name,
        protocol: "C",
        metric: 0,
        isLocal: true,
        isIPv6: false
      });
    }
  }
}
function addStaticRoute(device, network, mask, nextHop, interfaceName) {
  if (!isValidIP(network) || !isValidMask(mask)) {
    return false;
  }
  if (nextHop && !isValidIP(nextHop)) {
    return false;
  }
  device.routingTable = device.routingTable.filter(
    (r) => !(r.network === network && r.mask === mask && r.protocol === "S")
  );
  device.routingTable.push({
    network,
    mask,
    nextHop,
    interface: interfaceName,
    protocol: "S",
    metric: 1,
    isLocal: false,
    isIPv6: false
  });
  return true;
}
function simulatePing(topology, sourceDevice, targetIP, count = 5) {
  const result = {
    sent: count,
    received: 0,
    results: [],
    rttMin: 999,
    rttAvg: 0,
    rttMax: 0
  };
  const srcInterface = sourceDevice.interfaces.find((i) => i.ip && !i.isShutdown);
  if (!srcInterface || !srcInterface.ip) {
    result.results = Array(count).fill(".");
    return result;
  }
  if (sourceDevice.interfaces.some((i) => i.ip === targetIP && !i.isShutdown)) {
    result.received = count;
    result.results = Array(count).fill("!");
    result.rttMin = 0;
    result.rttAvg = 0;
    result.rttMax = 1;
    return result;
  }
  for (let seq = 0; seq < count; seq++) {
    const reachable = tracePacketPath(topology, sourceDevice, srcInterface, targetIP);
    if (reachable) {
      result.results.push("!");
      result.received++;
      const rtt = 1 + Math.floor(Math.random() * 4);
      result.rttMin = Math.min(result.rttMin, rtt);
      result.rttMax = Math.max(result.rttMax, rtt);
    } else {
      result.results.push(".");
    }
  }
  if (result.received > 0) {
    result.rttAvg = Math.round((result.rttMin + result.rttMax) / 2);
  } else {
    result.rttMin = 0;
    result.rttMax = 0;
  }
  return result;
}
function tracePacketPath(topology, currentDevice, srcInterface, targetIP, visited = /* @__PURE__ */ new Set()) {
  if (visited.has(currentDevice.id)) return false;
  visited.add(currentDevice.id);
  if (visited.size > 30) return false;
  if (currentDevice.type === "router") {
    if (currentDevice.interfaces.some((i) => i.ip === targetIP && !i.isShutdown)) {
      return true;
    }
    const route = findRoute(currentDevice, targetIP);
    if (!route) return false;
    let outInterface;
    if (route.interface) {
      outInterface = currentDevice.interfaces.find((i) => i.name === route.interface);
    } else if (route.nextHop) {
      outInterface = currentDevice.interfaces.find(
        (i) => i.ip && i.subnetMask && isSameNetwork(i.ip, route.nextHop, i.subnetMask)
      );
    }
    if (!outInterface || outInterface.isShutdown || !outInterface.connectedTo) return false;
    const [nextDeviceId, nextInterfaceId] = outInterface.connectedTo.split("/");
    const nextDevice = topology.devices.get(nextDeviceId);
    if (!nextDevice) return false;
    const nextIface = nextDevice.interfaces.find((i) => i.id === nextInterfaceId);
    if (!nextIface || nextIface.isShutdown) return false;
    if (nextDevice.type === "switch") {
      return traceThroughSwitch(topology, nextDevice, nextIface, targetIP, visited);
    }
    if (nextDevice.interfaces.some((i) => i.ip === targetIP && !i.isShutdown)) {
      return true;
    }
    return tracePacketPath(topology, nextDevice, nextIface, targetIP, visited);
  }
  if (currentDevice.type === "switch") {
    return traceThroughSwitch(topology, currentDevice, srcInterface, targetIP, visited);
  }
  return false;
}
function traceThroughSwitch(topology, switchDevice, ingressInterface, targetIP, visited) {
  for (const iface of switchDevice.interfaces) {
    if (iface.id === ingressInterface.id || !iface.connectedTo || iface.isShutdown) continue;
    const [connDeviceId, connInterfaceId] = iface.connectedTo.split("/");
    const connDevice = topology.devices.get(connDeviceId);
    if (!connDevice || visited.has(connDevice.id)) continue;
    const connIface = connDevice.interfaces.find((i) => i.id === connInterfaceId);
    if (!connIface || connIface.isShutdown) continue;
    if (connDevice.type === "router") {
      if (connDevice.interfaces.some((i) => i.ip === targetIP && !i.isShutdown)) {
        return true;
      }
      if (tracePacketPath(topology, connDevice, connIface, targetIP, new Set(visited))) {
        return true;
      }
    } else if (connDevice.type === "switch") {
      if (traceThroughSwitch(topology, connDevice, connIface, targetIP, new Set(visited))) {
        return true;
      }
    }
  }
  return false;
}
function removeStaticRoute(device, network, mask) {
  const initialLength = device.routingTable.length;
  device.routingTable = device.routingTable.filter(
    (r) => !(r.network === network && r.mask === mask && r.protocol === "S")
  );
  return device.routingTable.length < initialLength;
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/routing/ospf.ts
var DEFAULT_HELLO_INTERVAL = 10;
var DEFAULT_DEAD_INTERVAL = 40;
var DEFAULT_COST = 10;
var DEFAULT_PRIORITY = 1;
function ipToInt(ip) {
  const parts = ip.split(".");
  return parseInt(parts[0]) << 24 | parseInt(parts[1]) << 16 | parseInt(parts[2]) << 8 | parseInt(parts[3]);
}
function ipMatchesNetwork(ip, network, wildcard) {
  const ipInt = ipToInt(ip);
  const netInt = ipToInt(network);
  const wildInt = ipToInt(wildcard);
  const maskInt = ~wildInt;
  return (ipInt & maskInt) === (netInt & maskInt);
}
function getHighestInterfaceIp(device) {
  let highestIp = 0;
  let highestIpStr = null;
  for (const iface of device.interfaces) {
    if (iface.ip && iface.status === "up" && !iface.isShutdown) {
      const ipInt = ipToInt(iface.ip);
      if (ipInt > highestIp) {
        highestIp = ipInt;
        highestIpStr = iface.ip;
      }
    }
  }
  return highestIpStr;
}
function createOSPFProcess(device, processId, routerId) {
  const selectedRouterId = routerId || getHighestInterfaceIp(device) || "0.0.0.0";
  const process = {
    processId,
    routerId: selectedRouterId,
    areas: /* @__PURE__ */ new Map(),
    interfaces: /* @__PURE__ */ new Map(),
    lsdb: /* @__PURE__ */ new Map(),
    neighbors: /* @__PURE__ */ new Map(),
    isActive: true,
    passiveInterfaces: /* @__PURE__ */ new Set(),
    defaultOriginate: false
  };
  device.ospfProcess = process;
  device.ospfConfig = {
    processId,
    routerId: selectedRouterId,
    networks: [],
    passiveInterfaces: [],
    defaultOriginate: false
  };
  return process;
}
function deleteOSPFProcess(device) {
  device.ospfProcess = null;
  device.ospfConfig = null;
  device.routingTable = device.routingTable.filter((route) => route.protocol !== "O");
}
function setOSPFRouterId(device, routerId) {
  if (device.ospfConfig) {
    device.ospfConfig.routerId = routerId;
  }
  if (device.ospfProcess) {
    device.ospfProcess.routerId = routerId;
  }
}
function addOSPFNetwork(device, network, wildcard, areaId) {
  if (!device.ospfConfig) return;
  device.ospfConfig.networks.push({ network, wildcard, areaId });
  activateOSPFOnInterfaces(device);
}
function removeOSPFNetwork(device, network, wildcard) {
  if (!device.ospfConfig) return;
  device.ospfConfig.networks = device.ospfConfig.networks.filter(
    (n) => n.network !== network || n.wildcard !== wildcard
  );
}
function setPassiveInterface(device, interfaceName, passive) {
  if (!device.ospfConfig || !device.ospfProcess) return;
  if (passive) {
    device.ospfConfig.passiveInterfaces.push(interfaceName);
    device.ospfProcess.passiveInterfaces.add(interfaceName);
  } else {
    device.ospfConfig.passiveInterfaces = device.ospfConfig.passiveInterfaces.filter(
      (i) => i.toLowerCase() !== interfaceName.toLowerCase()
    );
    device.ospfProcess.passiveInterfaces.delete(interfaceName);
  }
}
function setDefaultOriginate(device, originate) {
  if (!device.ospfConfig || !device.ospfProcess) return;
  device.ospfConfig.defaultOriginate = originate;
  device.ospfProcess.defaultOriginate = originate;
}
function activateOSPFOnInterfaces(device) {
  if (!device.ospfProcess || !device.ospfConfig) return;
  for (const iface of device.interfaces) {
    if (!iface.ip || iface.isShutdown) continue;
    for (const network of device.ospfConfig.networks) {
      if (ipMatchesNetwork(iface.ip, network.network, network.wildcard)) {
        if (!device.ospfProcess.interfaces.has(iface.name)) {
          addOSPFInterface(device, iface.name, network.areaId);
        }
        break;
      }
    }
  }
}
function addOSPFInterface(device, interfaceName, areaId) {
  if (!device.ospfProcess) return;
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface || !iface.ip) return;
  const ospfIface = {
    interfaceName,
    areaId,
    state: "Waiting",
    cost: calculateInterfaceCost(iface),
    helloInterval: DEFAULT_HELLO_INTERVAL,
    deadInterval: DEFAULT_DEAD_INTERVAL,
    priority: DEFAULT_PRIORITY,
    dr: "0.0.0.0",
    bdr: "0.0.0.0",
    neighbors: /* @__PURE__ */ new Map()
  };
  device.ospfProcess.interfaces.set(interfaceName, ospfIface);
  if (!device.ospfProcess.areas.has(areaId)) {
    device.ospfProcess.areas.set(areaId, {
      areaId,
      lsas: /* @__PURE__ */ new Map(),
      transitCapability: false,
      stubArea: false,
      defaultCost: 1
    });
  }
}
function calculateInterfaceCost(iface) {
  return DEFAULT_COST;
}
function setOSPFInterfaceCost(device, interfaceName, cost) {
  if (!device.ospfProcess) return;
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.cost = cost;
  }
}
function setOSPFInterfacePriority(device, interfaceName, priority) {
  if (!device.ospfProcess) return;
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.priority = Math.max(0, Math.min(255, priority));
  }
}
function setOSPFHelloInterval(device, interfaceName, interval) {
  if (!device.ospfProcess) return;
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.helloInterval = interval;
    ospfIface.deadInterval = interval * 4;
  }
}
function setOSPFDeadInterval(device, interfaceName, interval) {
  if (!device.ospfProcess) return;
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.deadInterval = interval;
  }
}
function getOSPFProcessInfo(device) {
  if (!device.ospfProcess) {
    return "OSPF not enabled\n";
  }
  const process = device.ospfProcess;
  let output = `Routing Process "ospf ${process.processId}" with ID ${process.routerId}
`;
  output += `Supports only single TOS(TOS0) routes
`;
  output += `Supports opaque LSA
`;
  output += `It is an area border router
`;
  output += `Initial SPF schedule delay 5000 msecs
`;
  output += `Minimum hold time between two consecutive SPFs 10000 msecs
`;
  output += `Maximum wait time between two consecutive SPFs 10000 msecs
`;
  output += `Incremental-SPF disabled
`;
  output += `Minimum LSA interval 5 secs
`;
  output += `Minimum LSA arrival 1000 msecs
`;
  output += `LSA group pacing timer 240 secs
`;
  output += `Interface flood pacing timer 33 msecs
`;
  output += `Retransmission pacing timer 66 msecs
`;
  output += `Number of external LSA 0. Checksum Sum 0x000000
`;
  output += `Number of opaque AS LSA 0. Checksum Sum 0x000000
`;
  output += `Number of DCbitless external and opaque AS LSA 0
`;
  output += `Number of DoNotAge external and opaque AS LSA 0
`;
  output += `Number of areas in this router is ${process.areas.size}. 1 normal 0 stub 0 nssa
`;
  output += `External flood list length 0
`;
  for (const area of process.areas.values()) {
    output += `
Area ${area.areaId}
`;
    output += `  Number of interfaces in this area is ${countInterfacesInArea(device, area.areaId)}
`;
    output += `  Area has no authentication
`;
    output += `  SPF algorithm last executed ${Date.now() % 1e3}ms ago
`;
    output += `  SPF algorithm executed 1 times
`;
    output += `  Area ranges are
`;
    output += `  Number of LSA ${area.lsas.size}. Checksum Sum 0x000000
`;
    output += `  Number of opaque link LSA 0. Checksum Sum 0x000000
`;
    output += `  Number of DCbitless LSA 0
`;
    output += `  Number of indication LSA 0
`;
    output += `  Number of DoNotAge LSA 0
`;
    output += `  Flood list length 0
`;
  }
  return output;
}
function countInterfacesInArea(device, areaId) {
  if (!device.ospfProcess) return 0;
  let count = 0;
  for (const ospfIface of device.ospfProcess.interfaces.values()) {
    if (ospfIface.areaId === areaId) count++;
  }
  return count;
}
function getOSPFNeighborTable(device) {
  if (!device.ospfProcess) {
    return "% OSPF not enabled\n";
  }
  const neighbors = Array.from(device.ospfProcess.neighbors.values());
  if (neighbors.length === 0) {
    return "% No OSPF neighbors\n";
  }
  let output = "\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n";
  for (const neighbor of neighbors) {
    const deadTime = Math.max(0, neighbor.deadTime - Math.floor((Date.now() - neighbor.lastHello) / 1e3));
    const deadTimeStr = `${deadTime}s`;
    output += `${neighbor.neighborId.padEnd(15)} `;
    output += `${String(neighbor.priority).padStart(3)} `;
    output += `${neighbor.state.padEnd(15)} `;
    output += `${deadTimeStr.padEnd(11)} `;
    output += `${neighbor.neighborIp.padEnd(15)} `;
    output += `${neighbor.interface}
`;
  }
  return output;
}
function getOSPFInterfaceInfo(device, interfaceName) {
  if (!device.ospfProcess) {
    return "% OSPF not enabled\n";
  }
  let output = "";
  const interfaces = interfaceName ? [device.ospfProcess.interfaces.get(interfaceName)].filter(Boolean) : Array.from(device.ospfProcess.interfaces.values());
  for (const ospfIface of interfaces) {
    if (!ospfIface) continue;
    const iface = device.interfaces.find((i) => i.name === ospfIface.interfaceName);
    output += `${ospfIface.interfaceName} is ${iface?.status === "up" ? "up" : "down"}, line protocol is ${iface?.status === "up" ? "up" : "down"}
`;
    output += `  Internet Address ${iface?.ip || "0.0.0.0"}/${iface?.subnetMask ? getMaskLength(iface.subnetMask) : 0}, Area ${ospfIface.areaId}
`;
    output += `  Process ID ${device.ospfProcess.processId}, Router ID ${device.ospfProcess.routerId}, Network Type BROADCAST, Cost: ${ospfIface.cost}
`;
    output += `  Transmit Delay is 1 sec, State ${ospfIface.state}, Priority ${ospfIface.priority}
`;
    output += `  Designated Router (ID) ${ospfIface.dr}, Interface address ${iface?.ip || "0.0.0.0"}
`;
    output += `  Backup Designated router (ID) ${ospfIface.bdr}, Interface address ${iface?.ip || "0.0.0.0"}
`;
    output += `  Timer intervals configured, Hello ${ospfIface.helloInterval}, Dead ${ospfIface.deadInterval}, Wait ${ospfIface.deadInterval}, Retransmit 5
`;
    output += `    oob-resync timeout 40
`;
    output += `    Hello due in ${Math.floor(Math.random() * ospfIface.helloInterval)}s
`;
    output += `  Supports Link-local Signaling (LLS)
`;
    output += `  Index 1/1, flood queue length 0
`;
    output += `  Next 0x0(0)/0x0(0)
`;
    output += `  Last flood scan length is 0, maximum is 0
`;
    output += `  Last flood scan time is 0 msec, maximum is 0 msec
`;
    output += `  Neighbor Count is ${ospfIface.neighbors.size}, Adjacent neighbor count is ${countFullNeighbors(ospfIface)}
`;
    output += `  Suppress hello for 0 neighbor(s)
`;
    output += `
`;
  }
  return output || "% No OSPF interfaces\n";
}
function getMaskLength(mask) {
  const octets = mask.split(".").map(Number);
  let count = 0;
  for (const octet of octets) {
    for (let i = 7; i >= 0; i--) {
      if (octet & 1 << i) count++;
    }
  }
  return count;
}
function countFullNeighbors(ospfIface) {
  let count = 0;
  for (const neighbor of ospfIface.neighbors.values()) {
    if (neighbor.state === "Full") count++;
  }
  return count;
}
function getOSPFDatabase(device, areaId) {
  if (!device.ospfProcess) {
    return "% OSPF not enabled\n";
  }
  let output = "\n            OSPF Router with ID (" + device.ospfProcess.routerId + ") (Process ID " + device.ospfProcess.processId + ")\n\n";
  output += "                Router Link States (Area " + (areaId || "0") + ")\n\n";
  output += "Link ID         ADV Router      Age         Seq#       Checksum Link count\n";
  for (const [key, lsa] of device.ospfProcess.lsdb) {
    const routerLSA = lsa;
    const age = Math.floor((Date.now() - routerLSA.header.lsSequenceNumber) / 1e3) % 3600;
    const seqHex = routerLSA.header.lsSequenceNumber.toString(16).padStart(8, "0");
    output += `${routerLSA.header.lsId.padEnd(15)} `;
    output += `${routerLSA.header.advertisingRouter.padEnd(15)} `;
    output += `${String(age).padStart(11)} `;
    output += `0x${seqHex} `;
    output += `0x${routerLSA.header.checksum.toString(16).padStart(4, "0")} `;
    output += `${routerLSA.links.length}
`;
  }
  return output;
}
function getOSPFRoutes(device) {
  const ospfRoutes = device.routingTable.filter((r) => r.protocol === "O");
  if (ospfRoutes.length === 0) {
    return "% No OSPF routes in routing table\n";
  }
  let output = "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n";
  output += "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n";
  output += "       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n";
  output += "       E1 - OSPF external type 1, E2 - OSPF external type 2\n";
  output += "\nGateway of last resort is not set\n\n";
  for (const route of ospfRoutes) {
    const cidr = getMaskLength(route.mask);
    const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected`;
    const outputLine = route.nextHop ? `O    ${route.network}/${cidr} [110/${route.metric}] ${via}, ${route.interface}` : `O    ${route.network} ${via}, ${route.interface}`;
    output += outputLine + "\n";
  }
  return output;
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/nat/natEngine.ts
function ipToLong2(ip) {
  const parts = ip.split(".");
  return (parseInt(parts[0]) << 24 | parseInt(parts[1]) << 16 | parseInt(parts[2]) << 8 | parseInt(parts[3])) >>> 0;
}
function longToIP2(long) {
  return `${long >>> 24 & 255}.${long >>> 16 & 255}.${long >>> 8 & 255}.${long & 255}`;
}
function generateIPRange(startIP, endIP) {
  const start = ipToLong2(startIP);
  const end = ipToLong2(endIP);
  const ips = [];
  for (let i = start; i <= end; i++) {
    ips.push(longToIP2(i));
  }
  return ips;
}
function setNATInside(device, interfaceName) {
  device.natConfig.insideInterfaces.add(interfaceName);
  device.natConfig.outsideInterfaces.delete(interfaceName);
}
function setNATOutside(device, interfaceName) {
  device.natConfig.outsideInterfaces.add(interfaceName);
  device.natConfig.insideInterfaces.delete(interfaceName);
}
function removeNATInterface(device, interfaceName) {
  device.natConfig.insideInterfaces.delete(interfaceName);
  device.natConfig.outsideInterfaces.delete(interfaceName);
}
function configureStaticNAT(device, localIP, globalIP) {
  device.natConfig.staticEntries.set(localIP, {
    localIP,
    globalIP
  });
  return true;
}
function removeStaticNAT(device, localIP) {
  return device.natConfig.staticEntries.delete(localIP);
}
function createNATPool(device, name, startIP, endIP, netmask) {
  const availableIPs = generateIPRange(startIP, endIP);
  const pool = {
    name,
    startIP,
    endIP,
    netmask,
    availableIPs
  };
  device.natConfig.pools.set(name, pool);
  return pool;
}
function deleteNATPool(device, name) {
  if (device.natConfig.overloadPool === name) {
    return false;
  }
  return device.natConfig.pools.delete(name);
}
function configurePATOverload(device, source, poolName) {
  if (source === "interface") {
    device.natConfig.overloadInterface = "interface";
    device.natConfig.overloadPool = void 0;
    return true;
  } else if (source === "pool" && poolName) {
    if (!device.natConfig.pools.has(poolName)) {
      return false;
    }
    device.natConfig.overloadInterface = void 0;
    device.natConfig.overloadPool = poolName;
    return true;
  }
  return false;
}
function showNATTranslations(device) {
  const config = device.natConfig;
  if (config.translations.size === 0) {
    return "% No NAT translations\n";
  }
  let output = "Pro Inside global      Inside local       Outside local      Outside global\n";
  for (const trans of config.translations.values()) {
    const proto = trans.protocol.toUpperCase().padEnd(4);
    const insideGlobal = trans.globalPort !== void 0 ? `${trans.globalIP}:${trans.globalPort}` : trans.globalIP;
    const insideLocal = trans.localPort !== void 0 ? `${trans.localIP}:${trans.localPort}` : trans.localIP;
    const outsideLocal = trans.remoteIP ? trans.remotePort !== void 0 ? `${trans.remoteIP}:${trans.remotePort}` : trans.remoteIP : "---";
    const outsideGlobal = outsideLocal;
    output += `${proto} ${insideGlobal.padEnd(20)} ${insideLocal.padEnd(20)} ${outsideLocal.padEnd(20)} ${outsideGlobal}
`;
  }
  return output;
}
function showNATStatistics(device) {
  const config = device.natConfig;
  let output = "Total active translations: " + config.translations.size + "\n";
  output += "Static translations: " + config.staticEntries.size + "\n";
  output += "Dynamic translations: " + (config.translations.size - config.staticEntries.size) + "\n";
  output += "Outside interfaces: " + Array.from(config.outsideInterfaces).join(", ") + "\n";
  output += "Inside interfaces: " + Array.from(config.insideInterfaces).join(", ") + "\n";
  if (config.overloadInterface || config.overloadPool) {
    output += "PAT (Overload) enabled\n";
  }
  return output;
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/stp/stpEngine.ts
var PORT_COSTS = {
  "10": 100,
  // 10 Mbps
  "100": 19,
  // 100 Mbps
  "1000": 4,
  // 1 Gbps
  "10000": 2
  // 10 Gbps
};
function generateBridgeID(priority, macAddress) {
  const priHex = priority.toString(16).padStart(4, "0");
  const macClean = macAddress.replace(/:/g, "").toLowerCase();
  return `${priHex}.${macClean}`;
}
function generatePortID(priority, portNumber) {
  return priority << 8 | portNumber & 255;
}
function getDefaultPathCost(interfaceName) {
  if (interfaceName.toLowerCase().includes("gigabit")) {
    return PORT_COSTS["1000"];
  } else if (interfaceName.toLowerCase().includes("fast")) {
    return PORT_COSTS["100"];
  } else if (interfaceName.toLowerCase().includes("ten")) {
    return PORT_COSTS["10000"];
  }
  return PORT_COSTS["100"];
}
function initializeSTP(device, vlanId = 1) {
  if (device.type !== "switch") {
    throw new Error("STP can only be initialized on switches");
  }
  const macAddress = device.interfaces[0]?.mac || "00:00:00:00:00:00";
  const priority = device.stpConfig.globalDefaults.priority;
  const bridgeID = generateBridgeID(priority, macAddress);
  const stpVlan = {
    vlanId,
    rootBridge: bridgeID,
    // Initially believe we are root
    rootPriority: priority,
    rootCost: 0,
    rootPort: null,
    bridgeID,
    bridgePriority: priority,
    maxAge: device.stpConfig.globalDefaults.maxAge,
    helloTime: device.stpConfig.globalDefaults.helloTime,
    forwardDelay: device.stpConfig.globalDefaults.forwardDelay,
    holdTime: 1,
    topologyChange: false,
    topologyChangeCount: 0,
    timeSinceTC: 0,
    ports: /* @__PURE__ */ new Map()
  };
  let portNumber = 1;
  for (const iface of device.interfaces) {
    const portID = generatePortID(128, portNumber++);
    const stpPort = {
      interfaceName: iface.name,
      role: "designated",
      // Initially all ports are designated
      state: "blocking",
      // Start in blocking state
      priority: 128,
      cost: getDefaultPathCost(iface.name),
      designatedRoot: bridgeID,
      designatedBridge: bridgeID,
      designatedPort: portID,
      portID,
      forwardTransitions: 0,
      bpduGuard: false,
      bpduFilter: false,
      rootGuard: false,
      portFast: false
    };
    stpVlan.ports.set(iface.name, stpPort);
  }
  device.stpConfig.vlanInstances.set(vlanId, stpVlan);
  return stpVlan;
}
function checkRootBridge(device, vlanId) {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return false;
  return stpVlan.bridgeID === stpVlan.rootBridge;
}
function setBridgePriority(device, vlanId, priority) {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  stpVlan.bridgePriority = priority;
  const macAddress = device.interfaces[0]?.mac || "00:00:00:00:00:00";
  stpVlan.bridgeID = generateBridgeID(priority, macAddress);
  if (checkRootBridge(device, vlanId)) {
    stpVlan.rootBridge = stpVlan.bridgeID;
  }
}
function setPortCost(device, vlanId, portName, cost) {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  port.cost = cost;
}
function setPortFast(device, vlanId, portName, enabled) {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  port.portFast = enabled;
  if (enabled) {
    port.state = "forwarding";
    port.role = "designated";
  }
}
function setBPDUGuard(device, vlanId, portName, enabled) {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  port.bpduGuard = enabled;
}
function showSTP(device, vlanId) {
  if (device.type !== "switch") {
    return "% STP is only available on switches\n";
  }
  const instances = vlanId ? [device.stpConfig.vlanInstances.get(vlanId)].filter(Boolean) : Array.from(device.stpConfig.vlanInstances.values());
  if (instances.length === 0) {
    return "% No STP instances configured\n";
  }
  let output = "";
  for (const stpVlan of instances) {
    output += `VLAN${stpVlan.vlanId}
`;
    output += `  Spanning tree enabled protocol ${device.stpConfig.mode}
`;
    output += `  Root ID    Priority    ${parseInt(stpVlan.rootBridge.substring(0, 4), 16)}
`;
    output += `             Address     ${stpVlan.rootBridge.substring(5)}
`;
    output += `             Cost        ${stpVlan.rootCost}
`;
    output += `             Port        ${stpVlan.rootPort || "0"}
`;
    output += `             Hello Time  ${stpVlan.helloTime} sec  Max Age ${stpVlan.maxAge} sec  Forward Delay ${stpVlan.forwardDelay} sec

`;
    output += `  Bridge ID  Priority    ${parseInt(stpVlan.bridgeID.substring(0, 4), 16)}
`;
    output += `             Address     ${stpVlan.bridgeID.substring(5)}
`;
    output += `             Hello Time  ${stpVlan.helloTime} sec  Max Age ${stpVlan.maxAge} sec  Forward Delay ${stpVlan.forwardDelay} sec
`;
    output += `             Aging Time  300

`;
    output += "Interface        Role      Sts       Cost      Prio.Nbr  Type\n";
    output += "---------------- --------- --------- --------- --------- -----------------\n";
    for (const port of stpVlan.ports.values()) {
      const role = port.role.padEnd(9);
      const state = port.state.padEnd(9);
      const cost = String(port.cost).padEnd(9);
      const prioNbr = `${port.priority}.${port.portID & 255}`.padEnd(9);
      const type = port.portFast ? "P2p Edge" : "P2p";
      output += `${port.interfaceName.padEnd(16)} ${role} ${state} ${cost} ${prioNbr} ${type}
`;
    }
    output += "\n";
  }
  return output;
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/dhcp/dhcpEngine.ts
var DEFAULT_LEASE_TIME = 86400;
function ipToLong3(ip) {
  const parts = ip.split(".");
  return (parseInt(parts[0]) << 24 | parseInt(parts[1]) << 16 | parseInt(parts[2]) << 8 | parseInt(parts[3])) >>> 0;
}
function longToIP3(long) {
  return `${long >>> 24 & 255}.${long >>> 16 & 255}.${long >>> 8 & 255}.${long & 255}`;
}
function applySubnetMask2(ip, mask) {
  const ipLong = ipToLong3(ip);
  const maskLong = ipToLong3(mask);
  return longToIP3(ipLong & maskLong);
}
function generateIPRange2(network, mask) {
  const netLong = ipToLong3(network);
  const maskLong = ipToLong3(mask);
  const hostBits = 32 - maskLong.toString(2).replace(/0/g, "").length;
  const numHosts = Math.pow(2, hostBits) - 2;
  const ips = [];
  for (let i = 1; i <= numHosts; i++) {
    ips.push(longToIP3(netLong + i));
  }
  return ips;
}
function createDHCPPool(device, name, network, mask) {
  const netAddr = applySubnetMask2(network, mask);
  if (netAddr !== network) {
    return null;
  }
  const availableIPs = generateIPRange2(network, mask);
  const pool = {
    name,
    network,
    mask,
    defaultRouter: [],
    dnsServer: [],
    domainName: void 0,
    leaseTime: DEFAULT_LEASE_TIME,
    excludedIPs: [],
    bindings: /* @__PURE__ */ new Map()
  };
  device.dhcpConfig.pools.set(name, pool);
  return pool;
}
function deleteDHCPPool(device, name) {
  return device.dhcpConfig.pools.delete(name);
}
function configurePoolOptions(device, poolName, options) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) return false;
  if (options.defaultRouter) pool.defaultRouter = options.defaultRouter;
  if (options.dnsServer) pool.dnsServer = options.dnsServer;
  if (options.domainName !== void 0) pool.domainName = options.domainName;
  if (options.leaseTime !== void 0) pool.leaseTime = options.leaseTime;
  return true;
}
function addExcludedIP(device, poolName, ip) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) return false;
  if (!pool.excludedIPs.includes(ip)) {
    pool.excludedIPs.push(ip);
  }
  return true;
}
function removeExcludedIP(device, poolName, ip) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) return false;
  pool.excludedIPs = pool.excludedIPs.filter((e) => e !== ip);
  return true;
}
function showDHCPPools(device) {
  if (device.dhcpConfig.pools.size === 0) {
    return "% No DHCP pools configured\n";
  }
  let output = "Pool                  : Network           / Mask              \n";
  output += "---------------------------------------------------------------\n";
  for (const pool of device.dhcpConfig.pools.values()) {
    const netStr = `${pool.network}/${pool.mask}`;
    output += `${pool.name.padEnd(21)} : ${netStr.padEnd(38)}
`;
    if (pool.defaultRouter.length > 0) {
      output += `  Default Router      : ${pool.defaultRouter.join(", ")}
`;
    }
    if (pool.dnsServer.length > 0) {
      output += `  DNS Server          : ${pool.dnsServer.join(", ")}
`;
    }
    if (pool.domainName) {
      output += `  Domain Name         : ${pool.domainName}
`;
    }
    output += `  Lease Time          : ${pool.leaseTime} seconds
`;
    if (pool.excludedIPs.length > 0) {
      output += `  Excluded IPs        : ${pool.excludedIPs.join(", ")}
`;
    }
    output += "\n";
  }
  return output;
}
function showDHCPBindings(device) {
  let totalBindings = 0;
  for (const pool of device.dhcpConfig.pools.values()) {
    totalBindings += pool.bindings.size;
  }
  if (totalBindings === 0) {
    return "% No DHCP bindings\n";
  }
  let output = "IP Address      Client ID/          Lease Expiration    Type\n";
  output += "                Hardware Address\n";
  output += "---------------------------------------------------------------\n";
  for (const pool of device.dhcpConfig.pools.values()) {
    for (const binding of pool.bindings.values()) {
      if (binding.state === "expired") continue;
      const clientId = binding.clientId || binding.mac;
      const expiry = new Date(binding.leaseExpiry).toLocaleString();
      const type = binding.state === "active" ? "Automatic" : "Offered";
      output += `${binding.ip.padEnd(15)} ${clientId.padEnd(20)} ${expiry.padEnd(20)} ${type}
`;
    }
  }
  return output;
}
function showDHCPStatistics(device) {
  let totalPools = device.dhcpConfig.pools.size;
  let totalBindings = 0;
  let activeBindings = 0;
  let expiredBindings = 0;
  for (const pool of device.dhcpConfig.pools.values()) {
    for (const binding of pool.bindings.values()) {
      totalBindings++;
      if (binding.state === "active") activeBindings++;
      if (binding.state === "expired") expiredBindings++;
    }
  }
  let output = "DHCP Server Statistics:\n";
  output += `  Pools configured    : ${totalPools}
`;
  output += `  Total bindings      : ${totalBindings}
`;
  output += `  Active bindings     : ${activeBindings}
`;
  output += `  Expired bindings    : ${expiredBindings}
`;
  output += `  DHCP service        : ${device.dhcpConfig.enabled ? "Enabled" : "Disabled"}
`;
  return output;
}
function configureDHCPRelay(device, interfaceName, serverIP) {
  device.dhcpConfig.relayTargets.set(interfaceName, serverIP);
}
function removeDHCPRelay(device, interfaceName) {
  device.dhcpConfig.relayTargets.delete(interfaceName);
}

// ../../../../../../private/tmp/netaxis-cisco-candidate/src/lib/cli/executor.ts
function isLoopback(iface) {
  return iface.name.toLowerCase().startsWith("loopback");
}
function formatEUI64LinkLocal(bytes) {
  const words = [];
  for (let i2 = 0; i2 < 8; i2++) {
    words.push(bytes[i2 * 2] << 8 | bytes[i2 * 2 + 1]);
  }
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i2 = 0; i2 < 8; i2++) {
    if (words[i2] === 0) {
      if (curStart === -1) curStart = i2;
      curLen++;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  const parts = [];
  let i = 0;
  while (i < 8) {
    if (i === bestStart && bestLen >= 2) {
      parts.push(i === 0 ? "::" : ":");
      i += bestLen;
    } else {
      parts.push((i > 0 && !(i === bestStart + bestLen && bestStart >= 0) ? ":" : "") + words[i].toString(16));
      i++;
    }
  }
  return parts.join("");
}
function getInterfaceStatusString(iface) {
  if (iface.isShutdown) {
    return "administratively down";
  }
  if (isLoopback(iface)) {
    return "up";
  }
  return iface.connectedTo ? "up" : "down";
}
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  if (days > 0) {
    return `${days}d${hours}h`;
  } else if (hours > 0) {
    return `${hours}h${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}
function showVersion(device) {
  const uptime = Math.floor(Date.now() / 1e3) % 1e6;
  return `
Cisco IOS Software, C${device.type === "router" ? "800" : "2960"} Software (C${device.type === "router" ? "800" : "2960"}-UNIVERSALK9-M), Version 15.7(3)M4, RELEASE SOFTWARE (fc1)
Technical Support: http://www.cisco.com/techsupport
Copyright (c) 1986-2018 by Cisco Systems, Inc.
Compiled Mon 10-Sep-18 06:25 by prod_rel_team

ROM: System Bootstrap, Version 15.4(1r)T, RELEASE SOFTWARE (fc1)

${device.name} uptime is ${formatUptime(uptime)}
System returned to ROM by reload at 00:00:00 UTC Mon Jan 1 2024
System restarted at 00:00:00 UTC Mon Jan 1 2024
System image file is "flash:c${device.type === "router" ? "800" : "2960"}-universalk9-mz.SPA.157-3.M4.bin"
Last reload type: Normal Reload

This product contains cryptographic features and is subject to United
States and local country laws governing import, export, transfer and
use. Delivery of Cisco cryptographic products does not imply
third-party authority to import, export, distribute or use encryption.
Importers, exporters, distributors and users are responsible for
compliance with U.S. and local country laws. By using this product you
agree to comply with applicable laws and regulations. If you are unable
to comply with U.S. and local laws, return this product immediately.

A summary of U.S. laws governing Cisco cryptographic products may be found at:
http://www.cisco.com/wwl/export/crypto/tool/stqrg.html

If you require further assistance please contact us by sending email to
export@cisco.com.

cisco ${device.type === "router" ? "C881-K9" : "WS-C2960+24TC-L"} ( revision A0 ) with ${device.type === "router" ? "236544K/26624K" : "262144K"} bytes of memory.
Processor board ID FGL1639216M
Last reset from power-on
1 Virtual Ethernet interface
${device.interfaces.length} ${device.type === "router" ? "Gigabit Ethernet" : "FastEthernet"} interfaces
32768K bytes of non-volatile configuration memory.
255744K bytes of physical memory.
249856K bytes of flash memory at bootflash:.

Configuration register is 0x2102
`;
}
function showRunningConfig(device) {
  let output = "Building configuration...\n\n";
  output += "Current configuration : " + device.runningConfig.length * 10 + " bytes\n";
  output += "!\n";
  output += "! Last configuration change at 00:00:00 UTC Mon Jan 1 2024\n";
  output += "!\n";
  output += "version 15.7\n";
  output += "service timestamps debug datetime msec\n";
  output += "service timestamps log datetime msec\n";
  output += "service password-encryption\n";
  output += "!\n";
  output += `hostname ${device.name}
`;
  output += "!\n";
  if (device.enableSecret) {
    output += `enable secret 5 ${device.enableSecret}
`;
  }
  if (device.enablePassword) {
    output += `enable password ${device.enablePassword}
`;
  }
  output += "!\n";
  if (device.bannerMotd) {
    output += `banner motd ^C${device.bannerMotd}^C
`;
  }
  output += "!\n";
  for (const iface of device.interfaces) {
    output += `interface ${iface.name}
`;
    if (iface.description) {
      output += ` description ${iface.description}
`;
    }
    if (iface.ip && iface.subnetMask) {
      output += ` ip address ${iface.ip} ${iface.subnetMask}
`;
    }
    if (iface.isShutdown) {
      output += " shutdown\n";
    } else {
      output += " no shutdown\n";
    }
    output += "!\n";
  }
  for (const route of device.routingTable) {
    if (route.protocol === "S") {
      output += `ip route ${route.network} ${route.mask} ${route.nextHop || route.interface}
`;
    }
  }
  output += "!\n";
  output += "end\n";
  return output;
}
function showStartupConfig(device) {
  if (device.startupConfig.length === 0) {
    return "startup-config is not present\n";
  }
  return showRunningConfig({ ...device, runningConfig: device.startupConfig });
}
function showIPInterfaceBrief(device) {
  let output = "\n";
  output += "Interface                  IP-Address      OK? Method Status                Protocol\n";
  for (const iface of device.interfaces) {
    const ip = iface.ip || "unassigned";
    const method = iface.ip ? "manual" : "unset";
    const status = getInterfaceStatusString(iface);
    const protocol = iface.isShutdown ? "down" : isLoopback(iface) || iface.connectedTo ? "up" : "down";
    output += `${iface.name.padEnd(26)} ${ip.padEnd(15)} YES ${method.padEnd(7)} ${status.padEnd(21)} ${protocol}
`;
  }
  return output + "\n";
}
function showInterfaces(device, interfaceName) {
  let output = "";
  const interfaces = interfaceName ? device.interfaces.filter((i) => i.name.toLowerCase() === interfaceName.toLowerCase()) : device.interfaces;
  for (const iface of interfaces) {
    const status = getInterfaceStatusString(iface);
    const protocol = iface.isShutdown ? "down" : isLoopback(iface) || iface.connectedTo ? "up" : "down";
    const isUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
    output += `${iface.name} is ${status}, line protocol is ${protocol}
`;
    const hwType = isLoopback(iface) ? "Loopback" : device.type === "router" ? "CN Gigabit Ethernet" : "EtherSVI";
    output += `  Hardware is ${hwType}, address is ${iface.mac} (bia ${iface.mac})
`;
    if (iface.description) {
      output += `  Description: ${iface.description}
`;
    }
    if (iface.ip && iface.subnetMask) {
      output += `  Internet address is ${iface.ip}/${getPrefixLength(iface.subnetMask)}
`;
    }
    output += `  MTU 1500 bytes, BW 100000 Kbit/sec, DLY 100 usec,
`;
    output += `     reliability 255/255, txload 1/255, rxload 1/255
`;
    output += `  Encapsulation ARPA, loopback not set
`;
    output += `  Keepalive set (10 sec)
`;
    if (isUp) {
      output += `  Full-duplex, 100Mb/s, media type is RJ45
`;
      output += `  output flow-control is unsupported, input flow-control is unsupported
`;
      output += `  ARP type: ARPA, ARP Timeout 04:00:00
`;
      output += `  Last input 00:00:00, output 00:00:00, output hang never
`;
      output += `  Last clearing of "show interface" counters never
`;
      output += `  Input queue: 0/75/0/0 (size/max/drops/flushes); Total output drops: 0
`;
      output += `  Queueing strategy: fifo
`;
      output += `  Output queue: 0/40 (size/max)
`;
      output += `  5 minute input rate 0 bits/sec, 0 packets/sec
`;
      output += `  5 minute output rate 0 bits/sec, 0 packets/sec
`;
      output += `     0 packets input, 0 bytes, 0 no buffer
`;
      output += `     Received 0 broadcasts (0 IP multicasts)
`;
      output += `     0 runts, 0 giants, 0 throttles
`;
      output += `     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored
`;
      output += `     0 watchdog, 0 multicast, 0 pause input
`;
      output += `     0 packets output, 0 bytes, 0 underruns
`;
      output += `     0 output errors, 0 collisions, 1 interface resets
`;
      output += `     0 unknown protocol drops
`;
      output += `     0 babbles, 0 late collision, 0 deferred
`;
      output += `     0 lost carrier, 0 no carrier, 0 pause output
`;
      output += `     0 output buffer failures, 0 output buffers swapped out
`;
    } else {
      output += `  ${iface.isShutdown ? "Administratively down" : "Disconnected"}
`;
    }
    output += "\n";
  }
  return output;
}
function showIPInterface(device, interfaceName) {
  let output = "";
  const interfaces = interfaceName ? device.interfaces.filter((i) => i.name.toLowerCase() === interfaceName.toLowerCase()) : device.interfaces;
  if (interfaces.length === 0) {
    return interfaceName ? `% Interface ${interfaceName} not found
` : "";
  }
  for (const iface of interfaces) {
    const status = getInterfaceStatusString(iface);
    const protocol = iface.isShutdown ? "down" : isLoopback(iface) || iface.connectedTo ? "up" : "down";
    output += `${iface.name} is ${status}, line protocol is ${protocol}
`;
    if (iface.ip && iface.subnetMask) {
      output += `  Internet address is ${iface.ip}/${getPrefixLength(iface.subnetMask)}
`;
      output += `  Broadcast address is 255.255.255.255
`;
    } else {
      output += `  Internet protocol processing disabled
`;
    }
    output += `  MTU is 1500 bytes
`;
    output += `  Directed broadcast forwarding is disabled
`;
    output += `  Outgoing Common access list is not set
`;
    output += `  Outgoing access list is not set
`;
    output += `  Inbound Common access list is not set
`;
    output += `  Inbound  access list is not set
`;
    output += `  Proxy ARP is enabled
`;
    output += `  Local Proxy ARP is disabled
`;
    output += `  Security level is default
`;
    output += `  Split horizon is enabled
`;
    output += `  ICMP redirects are always sent
`;
    output += `  ICMP unreachables are always sent
`;
    output += `  ICMP mask replies are never sent
`;
    output += `  IP fast switching is enabled
`;
    output += `  IP CEF switching is enabled
`;
    output += `  IP multicast fast switching is enabled
`;
    output += `  IP route-cache flags are Fast, CEF
`;
    output += `  Router Discovery is disabled
`;
    output += `  IP output packet accounting is disabled
`;
    output += `  IP access violation accounting is disabled
`;
    output += `  TCP/IP header compression is disabled
`;
    output += `  RTP/IP header compression is disabled
`;
    output += `  Probe proxy name replies are disabled
`;
    output += `  Policy routing is disabled
`;
    output += `  Network address translation is disabled
`;
    output += `  BGP Policy Mapping is disabled
`;
    output += `  Input features: MCI Check
`;
    output += `  IPv4 WCCP Redirect outbound is disabled
`;
    output += `  IPv4 WCCP Redirect inbound is disabled
`;
    output += `  IPv4 WCCP Redirect exclude is disabled
`;
    output += "\n";
  }
  return output;
}
function showIPRoute(device) {
  if (device.type === "switch") {
    return "IP routing not enabled on this switch\n";
  }
  let output = "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n";
  output += "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n";
  output += "       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n";
  output += "       E1 - OSPF external type 1, E2 - OSPF external type 2\n";
  output += "       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2\n";
  output += "       ia - IS-IS inter area, * - candidate default, U - per-user static route\n";
  output += "       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP\n";
  output += "       a - application route\n";
  output += "       + - replicated route, % - next hop override, p - overrides from PfR\n\n";
  const defaultRoute = device.routingTable.find(
    (r) => r.network === "0.0.0.0" && r.mask === "0.0.0.0"
  );
  if (defaultRoute) {
    const via = defaultRoute.nextHop || defaultRoute.interface || "unknown";
    output += `Gateway of last resort is ${via} to network 0.0.0.0

`;
  } else {
    output += "Gateway of last resort is not set\n\n";
  }
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && !iface.isShutdown) {
      const network = applySubnetMask(iface.ip, iface.subnetMask);
      output += `C        ${network}/${getPrefixLength(iface.subnetMask)} is directly connected, ${iface.name}
`;
      output += `L        ${iface.ip}/32 is directly connected, ${iface.name}
`;
    }
  }
  for (const route of device.routingTable) {
    if (route.protocol === "S") {
      const prefix = getPrefixLength(route.mask);
      const ad = 1;
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `S        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}
`;
    } else if (route.protocol === "O") {
      const prefix = getPrefixLength(route.mask);
      const ad = 110;
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `O        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}
`;
    } else if (route.protocol === "D") {
      const prefix = getPrefixLength(route.mask);
      const ad = 90;
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `D        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}
`;
    } else if (route.protocol === "R") {
      const prefix = getPrefixLength(route.mask);
      const ad = 120;
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `R        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}
`;
    }
  }
  return output + "\n";
}
function showARP(device) {
  if (device.type === "switch") {
    return "This command is available only on routers.\n";
  }
  let output = "Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n";
  for (const iface of device.interfaces) {
    if (iface.ip && !iface.isShutdown) {
      output += `Internet  ${iface.ip.padEnd(15)}  -          ${iface.mac}  ARPA   ${iface.name}
`;
    }
  }
  device.arpTable.forEach((mac, ip) => {
    const matchingIface = device.interfaces.find(
      (i) => i.ip && i.subnetMask && isSameNetwork(i.ip, ip, i.subnetMask)
    );
    const ifaceName = matchingIface?.name || "Unknown";
    output += `Internet  ${ip.padEnd(15)}  0          ${mac}  ARPA   ${ifaceName}
`;
  });
  return output + "\n";
}
function showMACTable(device) {
  if (device.type === "router") {
    return "MAC address table is only available on switches.\n";
  }
  let output = "\n          Mac Address Table\n";
  output += "-------------------------------------------\n";
  output += "Vlan    Mac Address       Type        Ports\n";
  output += "----    -----------       --------    -----\n";
  device.macTable.forEach((interfaceId, mac) => {
    const iface = device.interfaces.find((i) => i.id === interfaceId);
    const port = iface ? iface.name.replace("FastEthernet", "Fa") : "Unknown";
    output += `  1    ${mac}    DYNAMIC     ${port}
`;
  });
  output += "-------------------------------------------\n";
  output += `Total Mac Addresses for this criterion: ${device.macTable.size}

`;
  return output;
}
function getPrefixLength(mask) {
  const parts = mask.split(".").map(Number);
  let bits = 0;
  for (const part of parts) {
    let n = part;
    while (n > 0) {
      bits += n & 1;
      n >>= 1;
    }
  }
  return bits;
}
function showCDPNeighbors(topology, device) {
  let output = "Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n";
  output += "                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone,\n";
  output += "                  D - Remote, C - CVTA, M - Two-port Mac Relay\n\n";
  output += "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n";
  for (const iface of device.interfaces) {
    if (!iface.connectedTo || iface.isShutdown) continue;
    const [connDeviceId, connInterfaceId] = iface.connectedTo.split("/");
    const connDevice = topology.devices.get(connDeviceId);
    if (!connDevice) continue;
    const connIface = connDevice.interfaces.find((i) => i.id === connInterfaceId);
    if (!connIface) continue;
    const capability = connDevice.type === "router" ? "R" : "S";
    const platform = connDevice.type === "router" ? "C881-K9" : "WS-C2960";
    const localPort = iface.name.replace("GigabitEthernet", "Gig ").replace("FastEthernet", "Fas ");
    const remotePort = connIface.name.replace("GigabitEthernet", "Gig ").replace("FastEthernet", "Fas ");
    output += `${connDevice.name.padEnd(16)} ${localPort.padEnd(17)} 180        ${capability.padEnd(11)} ${platform.padEnd(9)} ${remotePort}
`;
  }
  output += "\nTotal cdp entries displayed : " + device.interfaces.filter((i) => i.connectedTo && !i.isShutdown).length + "\n";
  return output;
}
function handleInterfaceEntry(device, interfaceName) {
  const existing = device.interfaces.find(
    (i) => i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  if (existing) {
    return { success: true, output: "", stateChanged: false };
  }
  const loopbackMatch = interfaceName.match(/^[Ll]oopback\s*(\d+)$/);
  if (loopbackMatch) {
    const loopNum = parseInt(loopbackMatch[1], 10);
    const canonicalName = `Loopback${loopNum}`;
    const newIface = {
      id: `${device.id}-lo${loopNum}`,
      name: canonicalName,
      ip: null,
      subnetMask: null,
      mac: generateMAC(),
      status: "up",
      connectedTo: null,
      isShutdown: false,
      description: "",
      switchportMode: "access",
      accessVlan: 0,
      trunkVlans: [],
      nativeVlan: 0,
      isSubinterface: false,
      parentInterface: null,
      encapsulation: null,
      ipv6: null,
      ipv6PrefixLength: 64,
      ipv6LinkLocal: null,
      portSecurity: {
        enabled: false,
        maxMacAddresses: 1,
        violationMode: "shutdown",
        stickyMacEnabled: false,
        secureMacAddresses: [],
        violationCount: 0,
        errDisabled: false
      }
    };
    device.interfaces.push(newIface);
    device.runningConfig.push(`interface ${canonicalName}`);
    return {
      success: true,
      output: "",
      stateChanged: true
    };
  }
  const subifaceMatch = interfaceName.match(/^([Gg]igabit[Ee]thernet\d+\/\d+)\.(\d+)$/);
  if (subifaceMatch) {
    const parentName = subifaceMatch[1];
    const vlanId = parseInt(subifaceMatch[2], 10);
    const parent = device.interfaces.find(
      (i) => i.name.toLowerCase() === parentName.toLowerCase()
    );
    if (!parent) {
      return {
        success: false,
        output: "",
        error: `% Parent interface ${parentName} does not exist
`,
        stateChanged: false
      };
    }
    const canonicalName = parentName.charAt(0).toUpperCase() + parentName.slice(1) + "." + vlanId;
    const newIface = {
      id: `${device.id}-sub-${parentName.replace(/\//g, "-")}-${vlanId}`,
      name: canonicalName,
      ip: null,
      subnetMask: null,
      mac: generateMAC(),
      status: parent.status,
      connectedTo: null,
      isShutdown: false,
      description: "",
      switchportMode: "access",
      accessVlan: 0,
      trunkVlans: [],
      nativeVlan: 0,
      isSubinterface: true,
      parentInterface: parentName,
      encapsulation: vlanId,
      ipv6: null,
      ipv6PrefixLength: 64,
      ipv6LinkLocal: null,
      portSecurity: {
        enabled: false,
        maxMacAddresses: 1,
        violationMode: "shutdown",
        stickyMacEnabled: false,
        secureMacAddresses: [],
        violationCount: 0,
        errDisabled: false
      }
    };
    device.interfaces.push(newIface);
    device.runningConfig.push(`interface ${canonicalName}`);
    return {
      success: true,
      output: "",
      stateChanged: true
    };
  }
  const vlanMatch = interfaceName.match(/^[Vv]lan\s*(\d+)$/);
  if (vlanMatch) {
    const vlanNum = parseInt(vlanMatch[1], 10);
    const canonicalName = `Vlan${vlanNum}`;
    if (device.type === "switch") {
      const vlan = device.vlans.get(vlanNum);
      if (!vlan) {
        return {
          success: false,
          output: "",
          error: `% VLAN ${vlanNum} does not exist
`,
          stateChanged: false
        };
      }
    }
    const newIface = {
      id: `${device.id}-vlan${vlanNum}`,
      name: canonicalName,
      ip: null,
      subnetMask: null,
      mac: generateMAC(),
      status: "down",
      // SVI is down until there's at least one port in that VLAN
      connectedTo: null,
      isShutdown: false,
      description: "",
      switchportMode: "access",
      accessVlan: vlanNum,
      trunkVlans: [],
      nativeVlan: 0,
      isSubinterface: false,
      parentInterface: null,
      encapsulation: null,
      ipv6: null,
      ipv6PrefixLength: 64,
      ipv6LinkLocal: null,
      portSecurity: {
        enabled: false,
        maxMacAddresses: 1,
        violationMode: "shutdown",
        stickyMacEnabled: false,
        secureMacAddresses: [],
        violationCount: 0,
        errDisabled: false
      }
    };
    device.interfaces.push(newIface);
    device.runningConfig.push(`interface ${canonicalName}`);
    return {
      success: true,
      output: "",
      stateChanged: true
    };
  }
  return {
    success: false,
    output: "",
    error: `% Invalid interface type and target
`,
    stateChanged: false
  };
}
function setHostname(device, name) {
  const sanitized = sanitizeInput(name).trim();
  if (!isValidHostname(sanitized)) {
    return {
      success: false,
      output: "",
      error: "Invalid hostname format. Must start with alphanumeric, contain only letters, numbers, and hyphens, max 63 chars.",
      stateChanged: false
    };
  }
  const truncated = truncate(sanitized, LIMITS.HOSTNAME_MAX_LEN);
  const oldName = device.name;
  device.name = truncated;
  device.runningConfig.push(`hostname ${name}`);
  return {
    success: true,
    output: "",
    stateChanged: true
  };
}
function setIPAddress(device, interfaceName, ip, mask) {
  if (!isValidIP(ip)) {
    return {
      success: false,
      output: "",
      error: `Invalid IP address: ${ip}`,
      stateChanged: false
    };
  }
  if (!isValidMask(mask)) {
    return {
      success: false,
      output: "",
      error: `Invalid subnet mask: ${mask}`,
      stateChanged: false
    };
  }
  const iface = device.interfaces.find(
    (i) => i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  if (!iface) {
    return {
      success: false,
      output: "",
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false
    };
  }
  iface.ip = ip;
  iface.subnetMask = mask;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip address ${ip} ${mask}`);
  addConnectedRoutes(device);
  return {
    success: true,
    output: "",
    stateChanged: true
  };
}
function removeIPAddress(device, interfaceName) {
  const iface = device.interfaces.find(
    (i) => i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  if (!iface) {
    return {
      success: false,
      output: "",
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false
    };
  }
  iface.ip = null;
  iface.subnetMask = null;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(" no ip address");
  addConnectedRoutes(device);
  return {
    success: true,
    output: "",
    stateChanged: true
  };
}
function setShutdown(device, interfaceName, shutdown) {
  const iface = device.interfaces.find(
    (i) => i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  if (!iface) {
    return {
      success: false,
      output: "",
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false
    };
  }
  const wasUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
  iface.isShutdown = shutdown;
  iface.status = shutdown ? "administratively down" : isLoopback(iface) || iface.connectedTo ? "up" : "down";
  const isUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(shutdown ? " shutdown" : " no shutdown");
  addConnectedRoutes(device);
  let syslog = "";
  if (wasUp !== isUp) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 23);
    const stateStr = isUp ? "up" : "down";
    const protoStr = isUp ? "up" : "down";
    syslog += `${timestamp}: %LINK-3-UPDOWN: Interface ${iface.name}, changed state to ${stateStr}
`;
    syslog += `${timestamp}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to ${protoStr}
`;
  }
  return {
    success: true,
    output: syslog,
    stateChanged: true
  };
}
function setDescription(device, interfaceName, description) {
  const iface = device.interfaces.find(
    (i) => i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  if (!iface) {
    return {
      success: false,
      output: "",
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false
    };
  }
  const sanitized = sanitizeInput(description);
  const truncated = truncate(sanitized, LIMITS.DESCRIPTION_MAX_LEN);
  iface.description = truncated;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` description ${truncated}`);
  return {
    success: true,
    output: "",
    stateChanged: true
  };
}
function removeDescription(device, interfaceName) {
  return setDescription(device, interfaceName, "");
}
function createVlan(device, vlanId) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "VLAN configuration is only available on switches", stateChanged: false };
  }
  if (vlanId < 1 || vlanId > 4094) {
    return { success: false, output: "", error: "% Bad VLAN list - character #1 is a non-numeric character.", stateChanged: false };
  }
  if (vlanId === 1) {
    return { success: true, output: "Default VLAN 1 already exists\n", stateChanged: false };
  }
  if (!device.vlans.has(vlanId)) {
    const vlan = { id: vlanId, name: `VLAN${String(vlanId).padStart(4, "0")}`, interfaces: [] };
    device.vlans.set(vlanId, vlan);
    device.vlanDatabase.push(vlan);
  }
  device.runningConfig.push(`vlan ${vlanId}`);
  return { success: true, output: "", stateChanged: true };
}
function deleteVlan(device, vlanId) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "VLAN configuration is only available on switches", stateChanged: false };
  }
  if (vlanId === 1) {
    return { success: false, output: "", error: "% Default VLAN 1 may not be deleted.", stateChanged: false };
  }
  if (!device.vlans.has(vlanId)) {
    return { success: false, output: "", error: `% VLAN ${vlanId} not found`, stateChanged: false };
  }
  const vlan = device.vlans.get(vlanId);
  const defaultVlan = device.vlans.get(1);
  for (const ifaceId of vlan.interfaces) {
    const iface = device.interfaces.find((i) => i.id === ifaceId);
    if (iface && iface.accessVlan === vlanId) {
      iface.accessVlan = 1;
      if (defaultVlan) defaultVlan.interfaces.push(ifaceId);
    }
  }
  device.vlans.delete(vlanId);
  device.vlanDatabase = device.vlanDatabase.filter((v) => v.id !== vlanId);
  device.runningConfig.push(`no vlan ${vlanId}`);
  return { success: true, output: "", stateChanged: true };
}
function setSwitchportMode(device, interfaceName, mode) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "% Interface is not a switchport", stateChanged: false };
  }
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: "", error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }
  iface.switchportMode = mode;
  if (mode === "trunk") {
    iface.trunkVlans = [];
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport mode ${mode}`);
  return { success: true, output: "", stateChanged: true };
}
function setSwitchportAccessVlan(device, interfaceName, vlanId) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "% Interface is not a switchport", stateChanged: false };
  }
  if (vlanId < 1 || vlanId > 4094) {
    return { success: false, output: "", error: "% Access VLAN does not exist. Creating vlan.", stateChanged: false };
  }
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: "", error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }
  if (!device.vlans.has(vlanId)) {
    const vlan = { id: vlanId, name: `VLAN${String(vlanId).padStart(4, "0")}`, interfaces: [] };
    device.vlans.set(vlanId, vlan);
    device.vlanDatabase.push(vlan);
  }
  const oldVlan = device.vlans.get(iface.accessVlan);
  if (oldVlan) {
    oldVlan.interfaces = oldVlan.interfaces.filter((id) => id !== iface.id);
  }
  iface.accessVlan = vlanId;
  iface.switchportMode = "access";
  const newVlan = device.vlans.get(vlanId);
  if (!newVlan.interfaces.includes(iface.id)) {
    newVlan.interfaces.push(iface.id);
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport access vlan ${vlanId}`);
  return { success: true, output: "", stateChanged: true };
}
function setSwitchportTrunkAllowed(device, interfaceName, vlansStr) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "% Interface is not a switchport", stateChanged: false };
  }
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: "", error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }
  if (vlansStr.toLowerCase() === "all") {
    iface.trunkVlans = [];
  } else {
    const vlanIds = [];
    for (const part of vlansStr.split(",")) {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        for (let v = start; v <= end && v <= 4094; v++) vlanIds.push(v);
      } else {
        const v = parseInt(part, 10);
        if (v >= 1 && v <= 4094) vlanIds.push(v);
      }
    }
    iface.trunkVlans = vlanIds;
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport trunk allowed vlan ${vlansStr}`);
  return { success: true, output: "", stateChanged: true };
}
function setSwitchportTrunkNative(device, interfaceName, vlanId) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "% Interface is not a switchport", stateChanged: false };
  }
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: "", error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }
  iface.nativeVlan = vlanId;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport trunk native vlan ${vlanId}`);
  return { success: true, output: "", stateChanged: true };
}
function setEncapsulationDot1Q(device, interfaceName, vlanId) {
  const iface = device.interfaces.find((i) => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: "", error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }
  if (!iface.isSubinterface) {
    return { success: false, output: "", error: "% Encapsulation can only be set on subinterfaces", stateChanged: false };
  }
  iface.encapsulation = vlanId;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` encapsulation dot1Q ${vlanId}`);
  return { success: true, output: "", stateChanged: true };
}
function enableIPRouting(device) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "% IP routing can only be enabled on switches", stateChanged: false };
  }
  device.ipRouting = true;
  device.runningConfig.push("ip routing");
  return { success: true, output: "", stateChanged: true };
}
function disableIPRouting(device) {
  device.ipRouting = false;
  device.runningConfig.push("no ip routing");
  return { success: true, output: "", stateChanged: true };
}
function showVlan(device) {
  if (device.type !== "switch") {
    return "% This command is only available on switches.\n";
  }
  let output = "\nVLAN Name                             Status    Ports\n";
  output += "---- -------------------------------- --------- -------------------------------\n";
  const sortedVlans = [...device.vlans.values()].sort((a, b) => a.id - b.id);
  for (const vlan of sortedVlans) {
    const ports = device.interfaces.filter((i) => i.switchportMode === "access" && i.accessVlan === vlan.id).map((i) => i.name.replace("FastEthernet", "Fa")).join(", ");
    output += `${String(vlan.id).padEnd(4)} ${vlan.name.padEnd(32)} active    ${ports}
`;
  }
  output += "\n";
  return output;
}
function showInterfacesTrunk(device) {
  if (device.type !== "switch") {
    return "% This command is only available on switches.\n";
  }
  const trunkPorts = device.interfaces.filter((i) => i.switchportMode === "trunk");
  if (trunkPorts.length === 0) {
    return "\nNo trunk interfaces configured.\n\n";
  }
  let output = "\nPort        Mode         Encapsulation  Status        Native vlan\n";
  output += "----------- ------------ -------------- ------------- -----------\n";
  for (const iface of trunkPorts) {
    const portName = iface.name.replace("FastEthernet", "Fa");
    const status = iface.isShutdown ? "not-connect" : iface.connectedTo ? "trunking" : "not-connect";
    output += `${portName.padEnd(11)} on           802.1q         ${status.padEnd(13)} ${iface.nativeVlan}
`;
  }
  output += "\nPort        Vlans allowed on trunk\n";
  output += "----------- ---------------------------------------------------------------------\n";
  for (const iface of trunkPorts) {
    const portName = iface.name.replace("FastEthernet", "Fa");
    const allowed = iface.trunkVlans.length === 0 ? "1-4094" : iface.trunkVlans.join(",");
    output += `${portName.padEnd(11)} ${allowed}
`;
  }
  output += "\n";
  return output;
}
function handleIPRoute(device, network, mask, nextHop, remove) {
  if (!isValidIP(network)) {
    return {
      success: false,
      output: "",
      error: `Invalid network address: ${network}`,
      stateChanged: false
    };
  }
  if (!isValidMask(mask)) {
    return {
      success: false,
      output: "",
      error: `Invalid subnet mask: ${mask}`,
      stateChanged: false
    };
  }
  if (nextHop && !isValidIP(nextHop)) {
    return {
      success: false,
      output: "",
      error: `Invalid next hop: ${nextHop}`,
      stateChanged: false
    };
  }
  if (device.type === "switch") {
    return {
      success: false,
      output: "",
      error: "IP routing is not enabled on switches",
      stateChanged: false
    };
  }
  if (remove) {
    const removed = removeStaticRoute(device, network, mask);
    if (removed) {
      device.runningConfig.push(`no ip route ${network} ${mask} ${nextHop || ""}`);
    }
    return {
      success: removed,
      output: removed ? "" : "No such route",
      stateChanged: removed
    };
  } else {
    const added = addStaticRoute(device, network, mask, nextHop, null);
    if (added) {
      device.runningConfig.push(`ip route ${network} ${mask} ${nextHop}`);
    }
    return {
      success: added,
      output: added ? "" : "Failed to add route",
      stateChanged: added
    };
  }
}
function writeMemory(device) {
  device.startupConfig = [...device.runningConfig];
  return {
    success: true,
    output: "Building configuration...\n[OK]\n",
    stateChanged: true
  };
}
function eraseStartup(device) {
  device.startupConfig = [];
  return {
    success: true,
    output: "Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]\n[OK]\nErase of nvram: complete\n",
    stateChanged: true
  };
}
function reload(device) {
  return {
    success: true,
    output: `

System Bootstrap, Version 15.4(1r)T, RELEASE SOFTWARE (fc1)
Technical Support: http://www.cisco.com/techsupport
Copyright (c) 2014 by cisco Systems, Inc.

Current image file: flash:c800-universalk9-mz.SPA.157-3.M4.bin
Booting ${device.name}...

Press RETURN to get started!

`,
    stateChanged: false
  };
}
function executePing(topology, device, target, queue) {
  if (!isValidIP(target)) {
    return {
      success: false,
      output: "",
      error: `Invalid IP address: ${target}`,
      stateChanged: false
    };
  }
  if (device.type === "switch") {
    return {
      success: false,
      output: "",
      error: "Ping is not available on switches",
      stateChanged: false
    };
  }
  const srcInterface = device.interfaces.find((i) => i.ip && !i.isShutdown);
  if (!srcInterface) {
    return {
      success: false,
      output: "",
      error: "No active interface with IP address",
      stateChanged: false
    };
  }
  const pingResult = simulatePing(topology, device, target, 5);
  let output = `Type escape sequence to abort.
`;
  output += `Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:
`;
  output += pingResult.results.join("");
  output += "\n";
  output += `Success rate is ${Math.round(pingResult.received / pingResult.sent * 100)} percent (${pingResult.received}/${pingResult.sent})`;
  if (pingResult.received > 0) {
    output += `, round-trip min/avg/max = ${pingResult.rttMin}/${pingResult.rttAvg}/${pingResult.rttMax} ms`;
  }
  output += "\n";
  if (srcInterface.ip) {
    const icmpPacket = createICMPPacket(
      "echo-request",
      srcInterface.ip,
      target,
      srcInterface.mac,
      "FF:FF:FF:FF:FF:FF"
    );
    queue.enqueue({
      id: nanoid(),
      type: "packet",
      timestamp: Date.now(),
      data: {
        packet: icmpPacket,
        ingressDevice: device.id,
        ingressInterface: srcInterface.id
      }
    });
  }
  return {
    success: true,
    output,
    stateChanged: false
  };
}
function handleRouterOSPF(device, processId) {
  if (device.type !== "router") {
    return { success: false, output: "", error: "OSPF can only be configured on routers", stateChanged: false };
  }
  if (device.ospfProcess) {
    return { success: true, output: "", stateChanged: false };
  }
  createOSPFProcess(device, processId);
  device.runningConfig.push(`router ospf ${processId}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoRouterOSPF(device) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  deleteOSPFProcess(device);
  device.runningConfig = device.runningConfig.filter((line) => !line.startsWith("router ospf"));
  return { success: true, output: "", stateChanged: true };
}
function handleOSPFNetwork(device, network, wildcard, area) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  if (!isValidIP(network)) {
    return { success: false, output: "", error: `Invalid network address: ${network}`, stateChanged: false };
  }
  if (!isValidIP(wildcard)) {
    return { success: false, output: "", error: `Invalid wildcard mask: ${wildcard}`, stateChanged: false };
  }
  addOSPFNetwork(device, network, wildcard, area);
  device.runningConfig.push(` network ${network} ${wildcard} area ${area}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoOSPFNetwork(device, network, wildcard) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  removeOSPFNetwork(device, network, wildcard);
  return { success: true, output: "", stateChanged: true };
}
function handleOSPFRouterId(device, routerId) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  if (!isValidIP(routerId)) {
    return { success: false, output: "", error: `Invalid router ID: ${routerId}`, stateChanged: false };
  }
  setOSPFRouterId(device, routerId);
  device.runningConfig.push(` router-id ${routerId}`);
  return { success: true, output: "", stateChanged: true };
}
function handleOSPFPassiveInterface(device, interfaceName, passive) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  setPassiveInterface(device, interfaceName, passive);
  if (passive) {
    device.runningConfig.push(` passive-interface ${interfaceName}`);
  } else {
    device.runningConfig.push(` no passive-interface ${interfaceName}`);
  }
  return { success: true, output: "", stateChanged: true };
}
function handleOSPFDefaultOriginate(device, originate) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  setDefaultOriginate(device, originate);
  if (originate) {
    device.runningConfig.push(" default-information originate");
  }
  return { success: true, output: "", stateChanged: true };
}
function handleIPOSPFCost(device, interfaceName, cost) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  if (cost < 1 || cost > 65535) {
    return { success: false, output: "", error: "Cost must be between 1 and 65535", stateChanged: false };
  }
  setOSPFInterfaceCost(device, interfaceName, cost);
  return { success: true, output: "", stateChanged: true };
}
function handleIPOSPFPriority(device, interfaceName, priority) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  if (priority < 0 || priority > 255) {
    return { success: false, output: "", error: "Priority must be between 0 and 255", stateChanged: false };
  }
  setOSPFInterfacePriority(device, interfaceName, priority);
  return { success: true, output: "", stateChanged: true };
}
function handleIPOSPFHelloInterval(device, interfaceName, interval) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  if (interval < 1 || interval > 65535) {
    return { success: false, output: "", error: "Hello interval must be between 1 and 65535", stateChanged: false };
  }
  setOSPFHelloInterval(device, interfaceName, interval);
  return { success: true, output: "", stateChanged: true };
}
function handleIPOSPFDeadInterval(device, interfaceName, interval) {
  if (!device.ospfProcess) {
    return { success: false, output: "", error: "OSPF is not configured", stateChanged: false };
  }
  if (interval < 1 || interval > 65535) {
    return { success: false, output: "", error: "Dead interval must be between 1 and 65535", stateChanged: false };
  }
  setOSPFDeadInterval(device, interfaceName, interval);
  return { success: true, output: "", stateChanged: true };
}
function handleAccessList(device, number, action, remainder) {
  const aclNum = parseInt(number, 10);
  if (isNaN(aclNum) || !isValidACLNumber(aclNum)) {
    return { success: false, output: "", error: `Invalid ACL number: ${number}`, stateChanged: false };
  }
  const aclType = getACLType(number);
  let acl = device.acls.get(number);
  if (!acl) {
    acl = createACL(device, number, aclType);
  }
  if (!acl) {
    return { success: false, output: "", error: "Failed to create ACL", stateChanged: false };
  }
  if (aclType === "standard") {
    const source = remainder[0];
    if (!source) {
      return { success: false, output: "", error: "Missing source address", stateChanged: false };
    }
    let srcIP;
    let srcWildcard;
    if (source.toLowerCase() === "any") {
      srcIP = "any";
      srcWildcard = "255.255.255.255";
    } else if (source.toLowerCase() === "host") {
      srcIP = remainder[1] || "";
      srcWildcard = "0.0.0.0";
    } else {
      srcIP = source;
      srcWildcard = remainder[1] || "0.0.0.0";
    }
    if (!isValidIP(srcIP) && srcIP !== "any") {
      return { success: false, output: "", error: `Invalid source IP: ${srcIP}`, stateChanged: false };
    }
    addACLEntry(device, number, {
      action,
      source: srcIP,
      sourceWildcard: srcWildcard
    });
    device.runningConfig.push(`access-list ${number} ${action} ${source}${remainder[1] ? " " + remainder[1] : ""}`);
  } else {
    const protocol = remainder[0];
    if (!protocol) {
      return { success: false, output: "", error: "Missing protocol", stateChanged: false };
    }
    const src = remainder[1];
    const dest = remainder[2];
    if (!src || !dest) {
      return { success: false, output: "", error: "Missing source or destination", stateChanged: false };
    }
    addACLEntry(device, number, {
      action,
      protocol,
      source: src,
      sourceWildcard: "0.0.0.0",
      destination: dest,
      destWildcard: "0.0.0.0"
    });
    device.runningConfig.push(`access-list ${number} ${action} ${remainder.join(" ")}`);
  }
  return { success: true, output: "", stateChanged: true };
}
function handleNoAccessList(device, number) {
  deleteACL(device, number);
  device.runningConfig.push(`no access-list ${number}`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPAccessListStandard(device, name) {
  if (device.acls.has(name)) {
    return { success: true, output: "", stateChanged: false };
  }
  createACL(device, name, "standard");
  device.runningConfig.push(`ip access-list standard ${name}`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPAccessListExtended(device, name) {
  if (device.acls.has(name)) {
    return { success: true, output: "", stateChanged: false };
  }
  createACL(device, name, "extended");
  device.runningConfig.push(`ip access-list extended ${name}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPAccessList(device, type, name) {
  deleteACL(device, name);
  device.runningConfig.push(`no ip access-list ${type} ${name}`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPAccessGroup(device, interfaceName, aclName, direction) {
  if (!["in", "out"].includes(direction)) {
    return { success: false, output: "", error: 'Direction must be "in" or "out"', stateChanged: false };
  }
  const result = applyACL(device, interfaceName, aclName, direction);
  if (!result) {
    return { success: false, output: "", error: `ACL ${aclName} does not exist`, stateChanged: false };
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip access-group ${aclName} ${direction}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPAccessGroup(device, interfaceName) {
  removeACLApplication(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip access-group`);
  return { success: true, output: "", stateChanged: true };
}
function handleNamedACLEntry(device, aclName, action, args) {
  if (!aclName) {
    return { success: false, output: "", error: "Not in ACL configuration mode", stateChanged: false };
  }
  const acl = device.acls.get(aclName);
  if (!acl) {
    return { success: false, output: "", error: `ACL ${aclName} does not exist`, stateChanged: false };
  }
  if (acl.type === "standard") {
    const source = args[0] || "any";
    const wildcard = args[1] || (source === "any" ? "255.255.255.255" : "0.0.0.0");
    addACLEntry(device, aclName, {
      action,
      source: source === "any" ? "0.0.0.0" : source,
      sourceWildcard: source === "any" ? "255.255.255.255" : wildcard
    });
    device.runningConfig.push(` ${action} ${args.join(" ")}`);
  } else {
    const protocol = args[0] || "ip";
    const src = args[1] || "any";
    const srcWild = src === "any" ? "255.255.255.255" : args[2] || "0.0.0.0";
    const dstIdx = src === "any" ? 2 : 3;
    const dst = args[dstIdx] || "any";
    const dstWild = dst === "any" ? "255.255.255.255" : args[dstIdx + 1] || "0.0.0.0";
    addACLEntry(device, aclName, {
      action,
      protocol,
      source: src === "any" ? "0.0.0.0" : src,
      sourceWildcard: src === "any" ? "255.255.255.255" : srcWild,
      destination: dst === "any" ? "0.0.0.0" : dst,
      destWildcard: dst === "any" ? "255.255.255.255" : dstWild
    });
    device.runningConfig.push(` ${action} ${args.join(" ")}`);
  }
  return { success: true, output: "", stateChanged: true };
}
function handleNamedACLRemark(device, aclName, text) {
  if (!aclName) {
    return { success: false, output: "", error: "Not in ACL configuration mode", stateChanged: false };
  }
  device.runningConfig.push(` remark ${text}`);
  return { success: true, output: "", stateChanged: false };
}
function handleIPNatStatic(device, localIP, globalIP) {
  if (!isValidIP(localIP) || !isValidIP(globalIP)) {
    return { success: false, output: "", error: "Invalid IP address", stateChanged: false };
  }
  configureStaticNAT(device, localIP, globalIP);
  device.runningConfig.push(`ip nat inside source static ${localIP} ${globalIP}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPNatStatic(device, localIP) {
  removeStaticNAT(device, localIP);
  device.runningConfig.push(`no ip nat inside source static ${localIP}`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPNatPool(device, name, startIP, endIP, netmask) {
  if (!isValidIP(startIP) || !isValidIP(endIP) || !isValidMask(netmask)) {
    return { success: false, output: "", error: "Invalid IP address or netmask", stateChanged: false };
  }
  createNATPool(device, name, startIP, endIP, netmask);
  device.runningConfig.push(`ip nat pool ${name} ${startIP} ${endIP} netmask ${netmask}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPNatPool(device, name) {
  const result = deleteNATPool(device, name);
  if (!result) {
    return { success: false, output: "", error: `Pool ${name} is in use`, stateChanged: false };
  }
  device.runningConfig.push(`no ip nat pool ${name}`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPNatDynamic(device, acl, pool, overload) {
  if (overload) {
    configurePATOverload(device, "pool", pool);
    device.runningConfig.push(`ip nat inside source list ${acl} pool ${pool} overload`);
  } else {
    configurePATOverload(device, "pool", pool);
    device.runningConfig.push(`ip nat inside source list ${acl} pool ${pool}`);
  }
  return { success: true, output: "", stateChanged: true };
}
function handleIPNatInside(device, interfaceName) {
  setNATInside(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip nat inside`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPNatInside(device, interfaceName) {
  removeNATInterface(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip nat inside`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPNatOutside(device, interfaceName) {
  setNATOutside(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip nat outside`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPNatOutside(device, interfaceName) {
  removeNATInterface(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip nat outside`);
  return { success: true, output: "", stateChanged: true };
}
function handleShowSTP(device, vlanId) {
  return { success: true, output: showSTP(device, vlanId), stateChanged: false };
}
function handleShowSTPVLAN(device, vlanId) {
  return { success: true, output: showSTP(device, vlanId), stateChanged: false };
}
function handleShowSTPSummary(device) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "STP is only available on switches", stateChanged: false };
  }
  let output = "Switch is in " + (device.stpConfig.enabled ? "STP" : "disabled") + " mode\n";
  output += "STP instances: " + device.stpConfig.vlanInstances.size + "\n";
  for (const [vlanId, stpVlan] of device.stpConfig.vlanInstances) {
    output += `  VLAN${vlanId}: Root = ${stpVlan.rootBridge === stpVlan.bridgeID ? "this switch" : stpVlan.rootBridge}
`;
  }
  return { success: true, output, stateChanged: false };
}
function handleSTPVLANPriority(device, vlan, priority) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "STP is only available on switches", stateChanged: false };
  }
  if (!device.stpConfig.vlanInstances.has(vlan)) {
    initializeSTP(device, vlan);
  }
  setBridgePriority(device, vlan, priority);
  device.runningConfig.push(`spanning-tree vlan ${vlan} priority ${priority}`);
  return { success: true, output: "", stateChanged: true };
}
function handleSTPPortFast(device, interfaceName, edge) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "STP is only available on switches", stateChanged: false };
  }
  if (!device.stpConfig.vlanInstances.has(1)) {
    initializeSTP(device, 1);
  }
  setPortFast(device, 1, interfaceName, true);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` spanning-tree portfast` + (edge ? " edge" : ""));
  return { success: true, output: "", stateChanged: true };
}
function handleNoSTPPortFast(device, interfaceName) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "STP is only available on switches", stateChanged: false };
  }
  setPortFast(device, 1, interfaceName, false);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no spanning-tree portfast`);
  return { success: true, output: "", stateChanged: true };
}
function handleSTPBPDUGuard(device, interfaceName, enabled) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "STP is only available on switches", stateChanged: false };
  }
  if (!device.stpConfig.vlanInstances.has(1)) {
    initializeSTP(device, 1);
  }
  setBPDUGuard(device, 1, interfaceName, enabled);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` spanning-tree bpduguard enable` : ` no spanning-tree bpduguard`);
  return { success: true, output: "", stateChanged: true };
}
function handleSTPCost(device, interfaceName, cost) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "STP is only available on switches", stateChanged: false };
  }
  if (!device.stpConfig.vlanInstances.has(1)) {
    initializeSTP(device, 1);
  }
  setPortCost(device, 1, interfaceName, cost);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` spanning-tree cost ${cost}`);
  return { success: true, output: "", stateChanged: true };
}
function handleShowDHCPPool(device) {
  return { success: true, output: showDHCPPools(device), stateChanged: false };
}
function handleShowDHCPBinding(device) {
  return { success: true, output: showDHCPBindings(device), stateChanged: false };
}
function handleShowDHCPStatistics(device) {
  return { success: true, output: showDHCPStatistics(device), stateChanged: false };
}
function handleIPDHCPPool(device, poolName) {
  createDHCPPool(device, poolName, "0.0.0.0", "255.255.255.0");
  device.runningConfig.push(`ip dhcp pool ${poolName}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPDHCPPool(device, poolName) {
  deleteDHCPPool(device, poolName);
  device.runningConfig.push(`no ip dhcp pool ${poolName}`);
  return { success: true, output: "", stateChanged: true };
}
function handleDHCPNetwork(device, poolName, network, mask) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: "", error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  pool.network = network;
  pool.mask = mask;
  device.runningConfig.push(` network ${network} ${mask}`);
  return { success: true, output: "", stateChanged: true };
}
function handleDHCPDefaultRouter(device, poolName, routers) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: "", error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  configurePoolOptions(device, poolName, { defaultRouter: routers });
  device.runningConfig.push(` default-router ${routers.join(" ")}`);
  return { success: true, output: "", stateChanged: true };
}
function handleDHCPDNSServer(device, poolName, servers) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: "", error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  configurePoolOptions(device, poolName, { dnsServer: servers });
  device.runningConfig.push(` dns-server ${servers.join(" ")}`);
  return { success: true, output: "", stateChanged: true };
}
function handleDHCPDomainName(device, poolName, name) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: "", error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  configurePoolOptions(device, poolName, { domainName: name });
  device.runningConfig.push(` domain-name ${name}`);
  return { success: true, output: "", stateChanged: true };
}
function handleDHCPLease(device, poolName, days, hours, minutes) {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: "", error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  const leaseTime = days * 86400 + hours * 3600 + minutes * 60;
  configurePoolOptions(device, poolName, { leaseTime });
  device.runningConfig.push(` lease ${days} ${hours} ${minutes}`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPDHCPExcluded(device, lowIP, highIP) {
  for (const pool of device.dhcpConfig.pools.values()) {
    addExcludedIP(device, pool.name, lowIP);
    if (highIP !== lowIP) {
      addExcludedIP(device, pool.name, highIP);
    }
  }
  if (lowIP === highIP) {
    device.runningConfig.push(`ip dhcp excluded-address ${lowIP}`);
  } else {
    device.runningConfig.push(`ip dhcp excluded-address ${lowIP} ${highIP}`);
  }
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPDHCPExcluded(device, lowIP, highIP) {
  for (const pool of device.dhcpConfig.pools.values()) {
    removeExcludedIP(device, pool.name, lowIP);
    if (highIP !== lowIP) {
      removeExcludedIP(device, pool.name, highIP);
    }
  }
  if (lowIP === highIP) {
    device.runningConfig.push(`no ip dhcp excluded-address ${lowIP}`);
  } else {
    device.runningConfig.push(`no ip dhcp excluded-address ${lowIP} ${highIP}`);
  }
  return { success: true, output: "", stateChanged: true };
}
function handleIPHelperAddress(device, interfaceName, serverIP) {
  configureDHCPRelay(device, interfaceName, serverIP);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip helper-address ${serverIP}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPHelperAddress(device, interfaceName) {
  removeDHCPRelay(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip helper-address`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPv6Address(device, interfaceName, address, prefixLength, eui64) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  if (!isValidIPv6(address)) {
    return { success: false, output: "", error: "Invalid IPv6 address format", stateChanged: false };
  }
  if (prefixLength < 0 || prefixLength > 128) {
    return { success: false, output: "", error: "Invalid prefix length (must be 0-128)", stateChanged: false };
  }
  iface.ipv6 = address;
  iface.ipv6PrefixLength = prefixLength;
  if (!iface.ipv6LinkLocal) {
    const macBytes = iface.mac.split(":").map((b) => parseInt(b, 16));
    const linkLocalBytes = [254, 128, 0, 0, 0, 0, 0, 0];
    linkLocalBytes.push(macBytes[0] ^ 2);
    linkLocalBytes.push(macBytes[1]);
    linkLocalBytes.push(macBytes[2]);
    linkLocalBytes.push(255);
    linkLocalBytes.push(254);
    linkLocalBytes.push(macBytes[3]);
    linkLocalBytes.push(macBytes[4]);
    linkLocalBytes.push(macBytes[5]);
    iface.ipv6LinkLocal = formatEUI64LinkLocal(linkLocalBytes);
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ipv6 address ${address}/${prefixLength}${eui64 ? " eui-64" : ""}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPv6Address(device, interfaceName) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  iface.ipv6 = null;
  iface.ipv6LinkLocal = null;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ipv6 address`);
  return { success: true, output: "", stateChanged: true };
}
function handleIPv6Enable(device, interfaceName, enabled) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  if (enabled && !iface.ipv6LinkLocal) {
    const macBytes = iface.mac.split(":").map((b) => parseInt(b, 16));
    const linkLocalBytes = [254, 128, 0, 0, 0, 0, 0, 0];
    linkLocalBytes.push(macBytes[0] ^ 2);
    linkLocalBytes.push(macBytes[1]);
    linkLocalBytes.push(macBytes[2]);
    linkLocalBytes.push(255);
    linkLocalBytes.push(254);
    linkLocalBytes.push(macBytes[3]);
    linkLocalBytes.push(macBytes[4]);
    linkLocalBytes.push(macBytes[5]);
    iface.ipv6LinkLocal = formatEUI64LinkLocal(linkLocalBytes);
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` ipv6 enable` : ` no ipv6 enable`);
  return { success: true, output: "", stateChanged: true };
}
function handleShowIPv6InterfaceBrief(device) {
  let output = "Interface              Status      Protocol\n";
  output += `${"Interface".padEnd(22)}${"IP-Address".padEnd(18)}${"Status".padEnd(12)}${"Protocol".padEnd(10)}
`;
  for (const iface of device.interfaces) {
    if (iface.isSubinterface) continue;
    const status = iface.isShutdown ? "administratively down" : iface.connectedTo ? "up" : "down";
    const protocol = iface.isShutdown ? "down" : iface.connectedTo ? "up" : "down";
    const ipv6 = iface.ipv6 || iface.ipv6LinkLocal || "unassigned";
    output += `${iface.name.padEnd(22)}${ipv6.padEnd(18)}${status.padEnd(12)}${protocol}
`;
  }
  return { success: true, output, stateChanged: false };
}
function handleShowIPv6Interface(device, interfaceName) {
  if (interfaceName) {
    const iface = device.interfaces.find((i) => i.name === interfaceName);
    if (!iface) {
      return { success: false, output: "", error: "Interface not found", stateChanged: false };
    }
    let output2 = `${iface.name} is ${iface.isShutdown ? "administratively down" : iface.connectedTo ? "up" : "down"}, line protocol is ${iface.isShutdown ? "down" : iface.connectedTo ? "up" : "down"}
`;
    output2 += `  Hardware is ${device.type === "router" ? "Gt96k FE" : "FastEthernet"}, address is ${iface.mac}
`;
    if (iface.description) {
      output2 += `  Description: ${iface.description}
`;
    }
    if (iface.ipv6) {
      output2 += `  IPv6 address: ${iface.ipv6}/${iface.ipv6PrefixLength}
`;
    }
    if (iface.ipv6LinkLocal) {
      output2 += `  IPv6 link-local address: ${iface.ipv6LinkLocal}
`;
    }
    return { success: true, output: output2, stateChanged: false };
  }
  let output = "";
  for (const iface of device.interfaces) {
    if (iface.isSubinterface) continue;
    if (iface.ipv6 || iface.ipv6LinkLocal) {
      output += `${iface.name}:
`;
      if (iface.ipv6) {
        output += `  IPv6 address: ${iface.ipv6}/${iface.ipv6PrefixLength}
`;
      }
      if (iface.ipv6LinkLocal) {
        output += `  IPv6 link-local address: ${iface.ipv6LinkLocal}
`;
      }
      output += "\n";
    }
  }
  return { success: true, output: output || "% No interfaces have IPv6 configured\n", stateChanged: false };
}
function handleShowIPv6Route(device) {
  const ipv6Routes = device.routingTable.filter((r) => r.isIPv6);
  if (ipv6Routes.length === 0) {
    return { success: true, output: "IPv6 Routing Table is empty\n", stateChanged: false };
  }
  let output = `IPv6 Routing Table - default - ${ipv6Routes.length} entries
`;
  output += "Codes: C - Connected, L - Local, S - Static, O - OSPF\n\n";
  for (const route of ipv6Routes) {
    const via = route.nextHop ? `via ${route.nextHop}` : "is directly connected";
    output += `${route.protocol}   ${route.network}/${route.mask} [${route.metric}/0]
`;
    output += `     ${via}${route.interface ? `, ${route.interface}` : ""}
`;
  }
  return { success: true, output, stateChanged: false };
}
function handleIPv6Route(device, network, nextHop, iface) {
  const route = {
    network,
    mask: "64",
    // Simplified, should parse from network
    nextHop,
    interface: iface,
    protocol: "S",
    metric: 1,
    isLocal: false,
    isIPv6: true
  };
  device.routingTable.push(route);
  device.runningConfig.push(`ipv6 route ${network} ${nextHop || iface}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoIPv6Route(device, network, nextHop, iface) {
  const index = device.routingTable.findIndex(
    (r) => r.isIPv6 && r.network === network && r.nextHop === nextHop && r.interface === iface
  );
  if (index >= 0) {
    device.routingTable.splice(index, 1);
  }
  device.runningConfig.push(`no ipv6 route ${network} ${nextHop || iface}`);
  return { success: true, output: "", stateChanged: true };
}
function handlePortSecurity(device, interfaceName, enabled) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "Port Security is only available on switches", stateChanged: false };
  }
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  if (iface.switchportMode !== "access") {
    return { success: false, output: "", error: "Port Security requires access port mode", stateChanged: false };
  }
  iface.portSecurity.enabled = enabled;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` switchport port-security` : ` no switchport port-security`);
  return { success: true, output: "", stateChanged: true };
}
function handlePortSecurityMaximum(device, interfaceName, max) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  if (max < 1 || max > 132) {
    return { success: false, output: "", error: "Maximum MAC addresses must be between 1 and 132", stateChanged: false };
  }
  iface.portSecurity.maxMacAddresses = max;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport port-security maximum ${max}`);
  return { success: true, output: "", stateChanged: true };
}
function handlePortSecurityViolation(device, interfaceName, mode) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  if (!["protect", "restrict", "shutdown"].includes(mode)) {
    return { success: false, output: "", error: "Violation mode must be protect, restrict, or shutdown", stateChanged: false };
  }
  iface.portSecurity.violationMode = mode;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport port-security violation ${mode}`);
  return { success: true, output: "", stateChanged: true };
}
function handlePortSecurityMac(device, interfaceName, mac, vlan) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  const macRegex = /^([0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}$/;
  const macColonRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
  if (!macRegex.test(mac) && !macColonRegex.test(mac)) {
    return { success: false, output: "", error: "Invalid MAC address format", stateChanged: false };
  }
  const normalizedMac = mac.toLowerCase().replace(/[.:-]/g, "");
  const formattedMac = `${normalizedMac.slice(0, 4)}.${normalizedMac.slice(4, 8)}.${normalizedMac.slice(8, 12)}`;
  if (iface.portSecurity.secureMacAddresses.length >= iface.portSecurity.maxMacAddresses) {
    return { success: false, output: "", error: "Maximum secure MAC addresses reached", stateChanged: false };
  }
  iface.portSecurity.secureMacAddresses.push({
    mac: formattedMac,
    vlan: vlan || iface.accessVlan || 1,
    type: "static",
    learnedAt: Date.now(),
    lastSeen: Date.now()
  });
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport port-security mac-address ${formattedMac}`);
  return { success: true, output: "", stateChanged: true };
}
function handleNoPortSecurityMac(device, interfaceName, mac, vlan) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  const normalizedMac = mac.toLowerCase().replace(/[.:-]/g, "");
  const formattedMac = `${normalizedMac.slice(0, 4)}.${normalizedMac.slice(4, 8)}.${normalizedMac.slice(8, 12)}`;
  const index = iface.portSecurity.secureMacAddresses.findIndex((m) => m.mac === formattedMac);
  if (index >= 0) {
    iface.portSecurity.secureMacAddresses.splice(index, 1);
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no switchport port-security mac-address ${formattedMac}`);
  return { success: true, output: "", stateChanged: true };
}
function handlePortSecuritySticky(device, interfaceName, enabled) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  iface.portSecurity.stickyMacEnabled = enabled;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` switchport port-security mac-address sticky` : ` no switchport port-security mac-address sticky`);
  return { success: true, output: "", stateChanged: true };
}
function handleShowPortSecurity(device, interfaceName) {
  if (device.type !== "switch") {
    return { success: false, output: "", error: "Port Security is only available on switches", stateChanged: false };
  }
  let output = "Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n";
  output += "                (Count)       (Count)          (Count)\n";
  output += "--------------------------------------------------------------------\n";
  const interfaces = interfaceName ? device.interfaces.filter((i) => i.name === interfaceName) : device.interfaces.filter((i) => i.portSecurity?.enabled);
  for (const iface of interfaces) {
    if (!iface.portSecurity?.enabled) continue;
    const secureCount = iface.portSecurity.secureMacAddresses.length;
    const action = iface.portSecurity.violationMode;
    output += `${iface.name.padEnd(13)} ${iface.portSecurity.maxMacAddresses.toString().padStart(8)} ${secureCount.toString().padStart(12)} ${iface.portSecurity.violationCount.toString().padStart(14)} ${action.padStart(15)}
`;
  }
  output += "----------------------------------------------------------------------\n";
  output += `Total Addresses in System (excluding one mac per port)     : 0
`;
  output += `Max Addresses limit in System (excluding one mac per port) : 4096
`;
  return { success: true, output, stateChanged: false };
}
function handleShowPortSecurityInterface(device, interfaceName) {
  const iface = device.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: "", error: "Interface not found", stateChanged: false };
  }
  const ps = iface.portSecurity;
  let output = `Port Security              : ${ps.enabled ? "Enabled" : "Disabled"}
`;
  output += `Port Status                : ${ps.errDisabled ? "Secure-shutdown" : iface.status}
`;
  output += `Violation Mode             : ${ps.violationMode}
`;
  output += `Maximum MAC Addresses      : ${ps.maxMacAddresses}
`;
  output += `Total MAC Addresses        : ${ps.secureMacAddresses.length}
`;
  output += `Configured MAC Addresses   : ${ps.secureMacAddresses.filter((m) => m.type === "static").length}
`;
  output += `Sticky MAC Addresses       : ${ps.secureMacAddresses.filter((m) => m.type === "sticky").length}
`;
  output += `Last Source Address:Vlan   : ${ps.lastViolationMac || "0000.0000.0000"}:${iface.accessVlan || 1}
`;
  output += `Security Violation Count   : ${ps.violationCount}
`;
  return { success: true, output, stateChanged: false };
}
function handleShowPortSecurityAddress(device) {
  let output = "Secure Mac Address Table\n";
  output += "------------------------------------------------------------------------\n";
  output += `Vlan    Mac Address       Type                          Ports
`;
  output += "------------------------------------------------------------------------\n";
  let hasEntries = false;
  for (const iface of device.interfaces) {
    if (!iface.portSecurity?.enabled) continue;
    for (const entry of iface.portSecurity.secureMacAddresses) {
      hasEntries = true;
      output += `${(entry.vlan || 1).toString().padStart(4)}    ${entry.mac.padEnd(18)}${entry.type.padStart(10)}                    ${iface.name}
`;
    }
  }
  output += "------------------------------------------------------------------------\n";
  if (!hasEntries) {
    return { success: true, output: "% No secure MAC addresses found\n", stateChanged: false };
  }
  return { success: true, output, stateChanged: false };
}
function executeCommand(action, topology, device, currentInterface, queue, state) {
  switch (action.type) {
    case "SHOW_VERSION":
      return { success: true, output: showVersion(device), stateChanged: false };
    case "SHOW_RUNNING_CONFIG":
      return { success: true, output: showRunningConfig(device), stateChanged: false };
    case "SHOW_STARTUP_CONFIG":
      return { success: true, output: showStartupConfig(device), stateChanged: false };
    case "SHOW_IP_INTERFACE_BRIEF":
      return { success: true, output: showIPInterfaceBrief(device), stateChanged: false };
    case "SHOW_IP_INTERFACE":
      return { success: true, output: showIPInterface(device, action.params.interface), stateChanged: false };
    case "SHOW_INTERFACES":
      return { success: true, output: showInterfaces(device, action.params.interface), stateChanged: false };
    case "SHOW_IP_ROUTE":
      return { success: true, output: showIPRoute(device), stateChanged: false };
    case "SHOW_ARP":
      return { success: true, output: showARP(device), stateChanged: false };
    case "SHOW_MAC_TABLE":
      return { success: true, output: showMACTable(device), stateChanged: false };
    case "SHOW_VLAN":
    case "SHOW_VLAN_BRIEF":
      return { success: true, output: showVlan(device), stateChanged: false };
    case "SHOW_INTERFACES_TRUNK":
      return { success: true, output: showInterfacesTrunk(device), stateChanged: false };
    case "SHOW_CDP_NEIGHBORS":
      return { success: true, output: showCDPNeighbors(topology, device), stateChanged: false };
    case "VLAN_CREATE":
      return createVlan(device, action.params.id);
    case "VLAN_DELETE":
      return deleteVlan(device, action.params.id);
    case "SWITCHPORT_MODE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setSwitchportMode(device, currentInterface, action.params.mode);
    case "SWITCHPORT_ACCESS_VLAN":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setSwitchportAccessVlan(device, currentInterface, action.params.vlan);
    case "SWITCHPORT_TRUNK_ALLOWED":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setSwitchportTrunkAllowed(device, currentInterface, action.params.vlans);
    case "SWITCHPORT_TRUNK_NATIVE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setSwitchportTrunkNative(device, currentInterface, action.params.vlan);
    case "ENCAPSULATION_DOT1Q":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setEncapsulationDot1Q(device, currentInterface, action.params.vlan);
    case "IP_ROUTING":
      return enableIPRouting(device);
    case "NO_IP_ROUTING":
      return disableIPRouting(device);
    case "INTERFACE":
      return handleInterfaceEntry(device, action.params.interface);
    case "ENABLE_SECRET":
      device.enableSecret = action.params.password;
      device.runningConfig.push(`enable secret 5 ${action.params.password}`);
      return { success: true, output: "", stateChanged: true };
    case "ENABLE_PASSWORD":
      device.enablePassword = action.params.password;
      device.runningConfig.push(`enable password ${action.params.password}`);
      return { success: true, output: "", stateChanged: true };
    case "NO_ENABLE_SECRET":
      device.enableSecret = void 0;
      device.runningConfig.push("no enable secret");
      return { success: true, output: "", stateChanged: true };
    case "NO_ENABLE_PASSWORD":
      device.enablePassword = void 0;
      device.runningConfig.push("no enable password");
      return { success: true, output: "", stateChanged: true };
    case "BANNER_MOTD": {
      const sanitized = sanitizeInput(action.params.text);
      const truncated = truncate(sanitized, LIMITS.BANNER_MAX_LEN);
      device.bannerMotd = truncated;
      device.runningConfig.push(`banner motd ^C${truncated}^C`);
      return { success: true, output: "", stateChanged: true };
    }
    case "NO_BANNER_MOTD":
      device.bannerMotd = void 0;
      device.runningConfig.push("no banner motd");
      return { success: true, output: "", stateChanged: true };
    case "HOSTNAME":
      return setHostname(device, action.params.name);
    case "IP_ADDRESS":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setIPAddress(device, currentInterface, action.params.ip, action.params.mask);
    case "NO_IP_ADDRESS":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return removeIPAddress(device, currentInterface);
    case "SHUTDOWN":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setShutdown(device, currentInterface, true);
    case "NO_SHUTDOWN":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setShutdown(device, currentInterface, false);
    case "DESCRIPTION":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return setDescription(device, currentInterface, action.params.text);
    case "NO_DESCRIPTION":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return removeDescription(device, currentInterface);
    case "IP_ROUTE":
      return handleIPRoute(device, action.params.network, action.params.mask, action.params.nextHop, false);
    case "NO_IP_ROUTE":
      return handleIPRoute(device, action.params.network, action.params.mask, action.params.nextHop, true);
    case "WRITE_MEMORY":
    case "COPY_RUN_START":
      return writeMemory(device);
    case "ERASE_STARTUP":
      return eraseStartup(device);
    case "RELOAD":
      return reload(device);
    case "CLEAR_MAC_TABLE":
      device.macTable.clear();
      return { success: true, output: "", stateChanged: true };
    case "CLEAR_ARP_CACHE":
      device.arpTable.clear();
      return { success: true, output: "", stateChanged: true };
    case "PING":
      return executePing(topology, device, action.params.target, queue);
    // OSPF show commands
    case "SHOW_IP_OSPF":
      return { success: true, output: getOSPFProcessInfo(device), stateChanged: false };
    case "SHOW_IP_OSPF_NEIGHBOR":
      return { success: true, output: getOSPFNeighborTable(device), stateChanged: false };
    case "SHOW_IP_OSPF_INTERFACE":
      return { success: true, output: getOSPFInterfaceInfo(device, action.params.interface), stateChanged: false };
    case "SHOW_IP_OSPF_DATABASE":
      return { success: true, output: getOSPFDatabase(device), stateChanged: false };
    case "SHOW_IP_ROUTE_OSPF":
      return { success: true, output: getOSPFRoutes(device), stateChanged: false };
    // OSPF router configuration
    case "ROUTER_OSPF":
      return handleRouterOSPF(device, action.params.processId);
    case "NO_ROUTER_OSPF":
      return handleNoRouterOSPF(device);
    case "OSPF_NETWORK":
      return handleOSPFNetwork(device, action.params.network, action.params.wildcard, action.params.area);
    case "NO_OSPF_NETWORK":
      return handleNoOSPFNetwork(device, action.params.network, action.params.wildcard);
    case "OSPF_ROUTER_ID":
      return handleOSPFRouterId(device, action.params.routerId);
    case "OSPF_PASSIVE_INTERFACE":
      return handleOSPFPassiveInterface(device, action.params.interface, true);
    case "NO_OSPF_PASSIVE_INTERFACE":
      return handleOSPFPassiveInterface(device, action.params.interface, false);
    case "OSPF_DEFAULT_ORIGINATE":
      return handleOSPFDefaultOriginate(device, true);
    case "NO_OSPF_DEFAULT_ORIGINATE":
      return handleOSPFDefaultOriginate(device, false);
    // OSPF interface configuration
    case "IP_OSPF_COST":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPOSPFCost(device, currentInterface, action.params.cost);
    case "IP_OSPF_PRIORITY":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPOSPFPriority(device, currentInterface, action.params.priority);
    case "IP_OSPF_HELLO_INTERVAL":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPOSPFHelloInterval(device, currentInterface, action.params.interval);
    case "IP_OSPF_DEAD_INTERVAL":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPOSPFDeadInterval(device, currentInterface, action.params.interval);
    // ACL show commands
    case "SHOW_ACCESS_LISTS":
      return { success: true, output: showACL(device, action.params.name), stateChanged: false };
    case "SHOW_IP_ACCESS_LISTS":
      return { success: true, output: showACL(device, action.params.name), stateChanged: false };
    // ACL configuration
    case "ACCESS_LIST":
      return handleAccessList(device, action.params.number, action.params.action, action.params.remainder);
    case "NO_ACCESS_LIST":
      return handleNoAccessList(device, action.params.number);
    case "IP_ACCESS_LIST_STANDARD":
      return handleIPAccessListStandard(device, action.params.name);
    case "IP_ACCESS_LIST_EXTENDED":
      return handleIPAccessListExtended(device, action.params.name);
    case "NO_IP_ACCESS_LIST":
      return handleNoIPAccessList(device, action.params.type, action.params.name);
    case "ACL_PERMIT":
    case "ACL_DENY": {
      const aclAction = action.type === "ACL_PERMIT" ? "permit" : "deny";
      const aclName = state?.configTarget || null;
      return handleNamedACLEntry(device, aclName, aclAction, action.params.args);
    }
    case "ACL_REMARK":
      return handleNamedACLRemark(device, state?.configTarget || null, action.params.text);
    case "EXIT_ACL":
      return { success: true, output: "", stateChanged: false };
    // ACL application
    case "IP_ACCESS_GROUP":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPAccessGroup(device, currentInterface, action.params.acl, action.params.direction);
    case "NO_IP_ACCESS_GROUP":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoIPAccessGroup(device, currentInterface);
    // NAT show commands
    case "SHOW_IP_NAT_TRANSLATIONS":
      return { success: true, output: showNATTranslations(device), stateChanged: false };
    case "SHOW_IP_NAT_STATISTICS":
      return { success: true, output: showNATStatistics(device), stateChanged: false };
    // NAT configuration
    case "IP_NAT_STATIC":
      return handleIPNatStatic(device, action.params.local, action.params.global);
    case "NO_IP_NAT_STATIC":
      return handleNoIPNatStatic(device, action.params.local);
    case "IP_NAT_POOL":
      return handleIPNatPool(device, action.params.name, action.params.start, action.params.end, action.params.netmask);
    case "NO_IP_NAT_POOL":
      return handleNoIPNatPool(device, action.params.name);
    case "IP_NAT_DYNAMIC":
      return handleIPNatDynamic(device, action.params.acl, action.params.pool, action.params.overload);
    // NAT interface commands
    case "IP_NAT_INSIDE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPNatInside(device, currentInterface);
    case "NO_IP_NAT_INSIDE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoIPNatInside(device, currentInterface);
    case "IP_NAT_OUTSIDE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPNatOutside(device, currentInterface);
    case "NO_IP_NAT_OUTSIDE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoIPNatOutside(device, currentInterface);
    // STP show commands
    case "SHOW_SPANNING_TREE":
      return handleShowSTP(device, action.params.vlan);
    case "SHOW_SPANNING_TREE_VLAN":
      return handleShowSTPVLAN(device, action.params.vlan);
    case "SHOW_SPANNING_TREE_SUMMARY":
      return handleShowSTPSummary(device);
    // STP configuration commands
    case "SPANNING_TREE_VLAN_PRIORITY":
      return handleSTPVLANPriority(device, action.params.vlan, action.params.priority);
    case "SPANNING_TREE_PORTFAST":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleSTPPortFast(device, currentInterface, action.params.edge);
    case "NO_SPANNING_TREE_PORTFAST":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoSTPPortFast(device, currentInterface);
    case "SPANNING_TREE_BPDUGUARD":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleSTPBPDUGuard(device, currentInterface, action.params.enabled);
    case "SPANNING_TREE_COST":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleSTPCost(device, currentInterface, action.params.cost);
    // DHCP show commands
    case "SHOW_IP_DHCP_POOL":
      return handleShowDHCPPool(device);
    case "SHOW_IP_DHCP_BINDING":
      return handleShowDHCPBinding(device);
    case "SHOW_IP_DHCP_STATISTICS":
      return handleShowDHCPStatistics(device);
    // DHCP configuration commands
    case "IP_DHCP_POOL":
      return handleIPDHCPPool(device, action.params.name);
    case "NO_IP_DHCP_POOL":
      return handleNoIPDHCPPool(device, action.params.name);
    case "DHCP_NETWORK": {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: "", error: "Not in DHCP pool configuration mode", stateChanged: false };
      }
      return handleDHCPNetwork(device, poolName, action.params.network, action.params.mask);
    }
    case "DHCP_DEFAULT_ROUTER": {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: "", error: "Not in DHCP pool configuration mode", stateChanged: false };
      }
      return handleDHCPDefaultRouter(device, poolName, action.params.routers);
    }
    case "DHCP_DNS_SERVER": {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: "", error: "Not in DHCP pool configuration mode", stateChanged: false };
      }
      return handleDHCPDNSServer(device, poolName, action.params.servers);
    }
    case "DHCP_DOMAIN_NAME": {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: "", error: "Not in DHCP pool configuration mode", stateChanged: false };
      }
      return handleDHCPDomainName(device, poolName, action.params.name);
    }
    case "DHCP_LEASE": {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: "", error: "Not in DHCP pool configuration mode", stateChanged: false };
      }
      return handleDHCPLease(device, poolName, action.params.days, action.params.hours, action.params.minutes);
    }
    case "IP_DHCP_EXCLUDED":
      return handleIPDHCPExcluded(device, action.params.low, action.params.high);
    case "NO_IP_DHCP_EXCLUDED":
      return handleNoIPDHCPExcluded(device, action.params.low, action.params.high);
    case "IP_HELPER_ADDRESS":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPHelperAddress(device, currentInterface, action.params.server);
    case "NO_IP_HELPER_ADDRESS":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoIPHelperAddress(device, currentInterface);
    // IPv6 commands
    case "IPV6_ADDRESS":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPv6Address(device, currentInterface, action.params.address, action.params.prefixLength, action.params.eui64);
    case "NO_IPV6_ADDRESS":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoIPv6Address(device, currentInterface);
    case "IPV6_ENABLE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPv6Enable(device, currentInterface, true);
    case "NO_IPV6_ENABLE":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleIPv6Enable(device, currentInterface, false);
    // IPv6 show commands
    case "SHOW_IPV6_INTERFACE_BRIEF":
      return handleShowIPv6InterfaceBrief(device);
    case "SHOW_IPV6_INTERFACE":
      return handleShowIPv6Interface(device, action.params.interface);
    case "SHOW_IPV6_ROUTE":
      return handleShowIPv6Route(device);
    // IPv6 route commands
    case "IPV6_ROUTE":
      return handleIPv6Route(device, action.params.network, action.params.nextHop, action.params.interface);
    case "NO_IPV6_ROUTE":
      return handleNoIPv6Route(device, action.params.network, action.params.nextHop, action.params.interface);
    // Port Security commands
    case "SWITCHPORT_PORT_SECURITY":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handlePortSecurity(device, currentInterface, action.params.enabled);
    case "SWITCHPORT_PORT_SECURITY_MAXIMUM":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handlePortSecurityMaximum(device, currentInterface, action.params.max);
    case "SWITCHPORT_PORT_SECURITY_VIOLATION":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handlePortSecurityViolation(device, currentInterface, action.params.mode);
    case "SWITCHPORT_PORT_SECURITY_MAC":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handlePortSecurityMac(device, currentInterface, action.params.mac, action.params.vlan);
    case "NO_SWITCHPORT_PORT_SECURITY_MAC":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handleNoPortSecurityMac(device, currentInterface, action.params.mac, action.params.vlan);
    case "SWITCHPORT_PORT_SECURITY_STICKY":
      if (!currentInterface) {
        return { success: false, output: "", error: "Not in interface configuration mode", stateChanged: false };
      }
      return handlePortSecuritySticky(device, currentInterface, action.params.enabled);
    // Port Security show commands
    case "SHOW_PORT_SECURITY":
      return handleShowPortSecurity(device, action.params.interface);
    case "SHOW_PORT_SECURITY_INTERFACE":
      return handleShowPortSecurityInterface(device, action.params.interface);
    case "SHOW_PORT_SECURITY_ADDRESS":
      return handleShowPortSecurityAddress(device);
    case "HELP":
      return {
        success: true,
        output: "Available commands: enable, disable, show, configure, interface, ip, ping, traceroute\n",
        stateChanged: false
      };
    case "HELP_CONTEXT":
      return {
        success: true,
        output: action.params.output,
        stateChanged: false
      };
    default:
      return {
        success: true,
        output: "",
        stateChanged: false
      };
  }
}
export {
  EventQueue,
  addConnectedRoutes,
  createDevice,
  createParserState,
  createTopology,
  executeCommand,
  generateInterfaces,
  getCompletions,
  getPrompt,
  parseCommand,
  simulatePing,
  transitionMode
};
