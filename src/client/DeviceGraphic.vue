<script setup>
import { useId } from 'vue'
defineProps({ type: String })
const id = `hardware-${useId()}`
</script>
<template>
  <svg viewBox="0 0 144 68" width="144" height="68" aria-hidden="true" class="device-hardware">
    <defs>
      <linearGradient :id="`${id}-blue`" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#168ee2"/><stop offset="1" stop-color="#064f99"/></linearGradient>
      <linearGradient :id="`${id}-metal`" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#62788f"/><stop offset=".5" stop-color="#263b50"/><stop offset="1" stop-color="#142536"/></linearGradient>
      <linearGradient :id="`${id}-screen`" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#075c91"/><stop offset="1" stop-color="#10b8b0"/></linearGradient>
    </defs>
    <ellipse cx="72" cy="62" rx="43" ry="4" fill="#020617" opacity=".5"/>
    <g v-if="type === 'router'" stroke-linejoin="round">
      <path d="M30 22v24c0 18 84 18 84 0V22" :fill="`url(#${id}-blue)`" stroke="#52b9fa" stroke-width="1.2"/>
      <ellipse cx="72" cy="22" rx="42" ry="16" fill="#248fd3" stroke="#7bd3ff" stroke-width="1.3"/>
      <path d="M30 45c10 16 74 16 84 0" fill="none" stroke="#68c4f7" opacity=".35"/>
      <g fill="#e2f6ff" stroke="#c1efff" stroke-width=".7"><path d="M43 21h21v-4l10 6-10 6v-4H43Z"/><path d="M101 16H80v4l-10-6 10-6v4h21Z"/><path d="M61 12l8-5 8 5h-5v8h-6v-8Z"/><path d="M83 27l-8 5-8-5h5v-8h6v8Z"/></g>
      <rect x="46" y="45" width="35" height="6" rx="2" fill="#04346c"/><path d="M50 47h4m3 0h4m3 0h4m3 0h4" stroke="#94d9ff" stroke-width="1.5"/><circle cx="96" cy="46" r="2.2" fill="#4ade80"/>
    </g>
    <g v-else-if="type === 'switch'">
      <path d="M16 27l13-15h94l10 15v25H16Z" :fill="`url(#${id}-metal)`" stroke="#9ab2c8"/>
      <path d="M16 27h117L123 12H29Z" fill="#526b81"/><path d="M26 20h93M30 17h87" stroke="#a0b5c5" opacity=".35"/><rect x="21" y="32" width="91" height="15" rx="2" fill="#0b1c2e"/>
      <g v-for="x in [25,36,47,58,69,80,91,102]" :key="x"><rect :x="x" y="35" width="7" height="8" rx="1" fill="#3b5368" stroke="#829cb1" stroke-width=".6"/><path :d="`M${x + 2} 38h3`" stroke="#bbd1e3"/><rect :x="x + 1" y="30" width="2" height="1.5" fill="#4ade80"/></g>
      <rect x="118" y="34" width="9" height="9" rx="1" fill="#122537" stroke="#9ab2c8"/><circle cx="122" cy="47" r="1.5" fill="#34d399"/>
    </g>
    <g v-else-if="type === 'pc'">
      <path d="M101 9l12-4 16 6v47l-16 5-12-7Z" fill="#334b60" stroke="#8aa4bc"/><path d="M113 6v56l16-5V11Z" :fill="`url(#${id}-metal)`"/><rect x="117" y="16" width="8" height="2" rx="1" fill="#91a8bb"/><rect x="117" y="22" width="8" height="2" rx="1" fill="#142333"/><circle cx="121" cy="33" r="2.5" fill="#55e6ce"/><path d="M117 44h8m-8 4h8m-8 4h8" stroke="#6b849c"/>
      <rect x="25" y="8" width="72" height="44" rx="4" :fill="`url(#${id}-metal)`" stroke="#a0bed3"/><rect x="29" y="12" width="64" height="34" rx="1.5" :fill="`url(#${id}-screen)`"/><path d="M29 39l26-24h15L38 46h-9Z" fill="#a6efff" opacity=".12"/>
      <path d="M49 51v7h25v-7M43 61h38" stroke="#829bb0" stroke-width="3" fill="#3a5268"/><circle cx="61" cy="49" r="1" fill="#55e6ce"/><path d="M22 59h68l5 6H16Z" fill="#425b70" stroke="#7b94a8"/><path d="M26 62h59" stroke="#adc3d4" stroke-dasharray="3 2"/>
      <g fill="#bdf6fa" opacity=".75"><rect x="53" y="22" width="16" height="10" rx="2"/><path d="M60 32v4m-9 0h20" stroke="#bdf6fa" stroke-width="1.4"/></g>
    </g>
    <g v-else-if="type === 'server'">
      <path d="M48 7l15-5 38 7v51l-15 6-38-7Z" fill="#536d84" stroke="#a3bace"/><path d="M48 7l38 6v53l-38-7Z" :fill="`url(#${id}-metal)`"/><path d="M86 13l15-4v51l-15 6Z" fill="#122537"/>
      <g v-for="y in [17,30,43]" :key="y"><path :d="`M53 ${y}l27 4v9l-27-4Z`" fill="#102438" stroke="#6c849b" stroke-width=".6"/><path :d="`M57 ${y + 4}l14 2`" stroke="#809bb3" stroke-width="2"/><circle cx="76" :cy="y + 6" r="1.7" fill="#4ade80"/></g><path d="M55 55l22 4" stroke="#4c6982" stroke-dasharray="2 2"/>
    </g>
    <g v-else-if="type === 'access-point'" stroke="#9bb8cb" stroke-linejoin="round">
      <path d="M37 41l20-14h49l10 17-18 15H47Z" fill="#516f88"/><path d="M37 41h61l18 3-18 15H47Z" :fill="`url(#${id}-metal)`"/><path d="M46 35V13m59 17V10" stroke="#c4d3df" stroke-width="4" stroke-linecap="round"/><circle cx="85" cy="47" r="2" fill="#4ade80" stroke="none"/><path d="M58 17q14-14 28 0M64 21q8-8 16 0M70 25q2-2 4 0" fill="none" stroke="#61dafa" stroke-width="2.2" stroke-linecap="round"/>
    </g>
    <g v-else-if="type === 'firewall'">
      <path d="M39 12l12-7h53v48l-12 7H39Z" fill="#a64a42" stroke="#fcaca3"/><path d="M39 12h53v48H39Z" fill="#723e43"/><path d="M39 24h53M39 36h53M39 48h53M56 12v12m19 0v12M56 36v12m19 0v12" stroke="#e1897e" stroke-width="2"/>
      <path d="M80 14l17 6v17c0 11-17 19-17 19S63 48 63 37V20Z" fill="#19354b" stroke="#9ad7e9" stroke-width="1.5"/><path d="M72 33l6 6 12-13" stroke="#60e7c8" stroke-width="3" fill="none"/>
    </g>
    <g v-else-if="type === 'printer'" stroke="#96b0c5">
      <rect x="51" y="5" width="43" height="27" rx="2" fill="#d4e4ed"/><path d="M58 11h28m-28 5h22" stroke="#758ca0"/><path d="M35 27l11-7h55l10 9v25H35Z" :fill="`url(#${id}-metal)`"/><rect x="42" y="32" width="62" height="15" rx="2" fill="#233e52"/><rect x="54" y="43" width="37" height="21" rx="1" fill="#e1ecf1"/><path d="M60 50h24m-24 5h24m-24 5h15" stroke="#7b91a4"/><circle cx="99" cy="28" r="2" fill="#4ade80" stroke="none"/>
    </g>
    <g v-else-if="type === 'internet'"><path d="M39 54a16 16 0 0 1-4-31 23 23 0 0 1 42-9 18 18 0 0 1 28 14 13 13 0 0 1-1 26Z" fill="#245b87" stroke="#78bfe5" stroke-width="1.5"/><circle cx="70" cy="36" r="15" fill="#123e67" stroke="#8cd8ef"/><ellipse cx="70" cy="36" rx="6" ry="15" fill="none" stroke="#8cd8ef"/><path d="M55 36h30M58 28h24M58 44h24" stroke="#8cd8ef"/></g>
    <g v-else><path d="M42 16l30-11 31 12v38L73 65 42 53Z" :fill="`url(#${id}-metal)`" stroke="#89a5bd"/><path d="M42 16l31 12 30-11M73 28v37" fill="none" stroke="#89a5bd"/><rect x="51" y="30" width="13" height="5" rx="1" fill="#5ce5ce"/></g>
  </svg>
</template>
