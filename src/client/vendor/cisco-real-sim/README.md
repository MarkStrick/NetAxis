# Cisco Real Sim core

Source: https://github.com/NETWORKERS-HOME-123/cisco-real-sim
Pinned commit: 64fa44b03a9273886e61e6db2b88ebcc6e451b4f
Copyright (c) 2026 Networkers Home. MIT license in LICENSE.

engine.js is an unminified browser ESM bundle of the upstream CLI parser/executor,
topology factory and simulation helpers. No React, Next.js, backend or upstream
UI is included. UUID generation uses the existing nanoid dependency instead of
adding uuid; NetAxis supplies its own stable device/interface identifiers.

NetAxis's adapter limits supported commands, runs this core in a Web Worker,
and uses the shared Cisco-style IPv4 forwarding path for CLI Ping and Scenario playback. This enforces configured gateways, connected/static routes, ARP next hops and return paths alongside VLAN/ACL checks.
The upstream reload banner is not exposed as a real Cisco boot. Routing output
from the core is mapped into the shared NetAxis route checks.
