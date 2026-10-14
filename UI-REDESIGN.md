# NetAxis usability review and redesign

Reviewed 13 Vue components, every application screen and dialog, seven active stylesheet layers, client utilities, and the existing frontend regression suite before implementation. Baseline: production build and 81 frontend tests pass. Desktop and mobile screenshots were captured against `scripts/preview-lab.js`, which uses a temporary database.

## Users and journeys

Network students and small teams use Thai interface copy alongside familiar network terms. Owners manage rooms and permissions; editors build and configure networks; viewers inspect, chat, and run permitted simulations.

| Journey | Existing path | Redesign priority |
| --- | --- | --- |
| First visit | One-time verification → sign in/register → create/join room | Explain each gate, retain security, label fields and failures |
| Return to work | Home/workspace → scroll past forms → open room | Put saved rooms first, searchable by name, description or code |
| Build network | Device category → model → confirm → canvas → inspector → connect ports | Keep explicit device confirmation; predictable tools and mobile inspector |
| Plan IPs | IP planning → requirements → calculate → scale/IPAM/IPv6 → save | Readable tables, mobile field labels, visible draft and save feedback |
| Verify | Validation → inspect issue → Simulator/scenario → packet details | Separate build tools from testing; retain every playback and detail control |
| Configure CLI | Select Cisco device → CLI → commands → save → simulate | Preserve worker, command history and draft protection; coherent dialog |
| Collaborate | Invite code → join role → chat/members/voice/tasks | Make invitation and collaboration visible, preserve permissions |
| File/room management | Export/import/restore → settings/recovery/delete | Clear scope, consistent confirmation and keyboard focus |

## Top 10 problems, ranked by user impact

1. **Major: returning users must pass setup forms to reach saved rooms.** Put rooms first; offer visible create/join shortcuts. Recognition over recall.
2. **Major: home and workspace appear identical and template navigation has no active state.** Give overview, rooms and template browsing distinct headings and locations while reusing the same workspace components.
3. **Major: mobile sidebars can remain focusable while visually off-screen, overlap each other, and lack explicit dismissal.** Open one at a time; give controls expanded states; make closed panels inert; add close actions. WCAG 2.4.3, 2.4.7.
4. **Major: settings, import, recovery, deletion and unsaved planning use inconsistent custom overlays without native focus containment.** Reuse the native DialogFrame, restore focus, support Escape and name every dialog. WCAG 2.1.1, 2.4.3, 4.1.2.
5. **Major: planning tables require desktop-width scanning on phones.** Stack rows into labeled records at narrow widths, preserving every field and result. WCAG 1.4.10.
6. **Major: navigation and editor controls compete; import/export and subnet actions repeat across unrelated places.** Keep task navigation, editing tools and file actions in separate predictable areas, with consistent labels and visible active states.
7. **Major: some errors, success messages and invalid calculator inputs lack clear local feedback.** Add announced feedback, associated account errors, actionable empty states and calculator explanations. WCAG 3.3.1, 4.1.3.
8. **Major: dark base styles leak into the light interface (IPv6 results, validation, voice, member status); native controls still inherit a dark color scheme.** Consolidate the shared light theme and semantic states in one authoritative stylesheet. WCAG 1.4.3, 1.4.11.
9. **Minor: forms expose secondary setup immediately; empty names disable creation without explaining why.** Keep required fields and permissions visible, progressively disclose optional description, prefill the existing account nickname and explain required fields.
10. **Minor: inconsistent density, fonts, spacing, button sizes and restore-file layout make unrelated screens feel like different products.** Use one restrained blue accent, solid surfaces, consistent typography and 4px spacing tokens; fix restore layout and thumbnail hierarchy.

## Prioritized implementation plan

1. Establish shared tokens and component states; consolidate `ui.css` rather than add another theme/dependency.
2. Improve workspace information order, search and template navigation; preserve deep links and all form actions.
3. Standardize dialogs, feedback and mobile panel behavior; preserve backend, permissions and draft guards.
4. Apply the same controls and hierarchy to planning, simulator, CLI, catalog, collaboration and account screens.
5. Adapt planning data, navigation and toolbars for 320px phones, tablets and desktops; respect reduced motion and 200% zoom.
6. Run build, frontend and server regression suites; use an isolated browser to verify keyboard focus, navigation, responsive overflow and the primary journeys.

## Design system

- Thai body: IBM Plex Sans Thai with system fallback. Body 16px/1.5; secondary/table text 14px; captions 12px; headings 20/24/32px. Monospace only for addresses, codes and terminal output.
- Neutral page background, white surfaces, ink text, readable slate secondary text. Blue is the action/navigation accent; green, amber and red convey labeled status.
- 4/8/12/16/20/24/32/40/48px spacing. Controls use 6px corners; panels 8px. Borders define structure; shadows reserved for overlays.
- Primary, secondary, quiet and destructive buttons share control heights and visible focus. Inputs use explicit labels, 44px height and 16px text.
- Desktop: visible task navigation and persistent device/inspector areas. Tablet: dismissible side panels. Phone: fixed labeled task navigation, touch controls and stacked planning records.
- Breakpoints: 600px (phone), 900px (panel layout), 1200px (compact desktop). Hover never supplies the only affordance.

Existing uncommitted application and account work is retained. No backend API or business model redesign is needed.

## Necessary compatibility repair

Functional verification reproduced a native `better-sqlite3` 11.10.0 crash during a real Undo request as well as several existing integration tests. Updating the existing dependency to 12.11.1 fixes compatibility with the project's documented Node 24 runtime. Version 12 introduced Node 24 support ([upstream release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.0.0)). Database format, API handlers, room permissions and business rules are unchanged; no new application dependency was introduced.

## Accessibility limits

Automated WCAG checks cover detectable contrast, semantics and labels; they do not certify full compliance. The existing first-visit image CAPTCHA still needs a nonvisual challenge alternative to support users who cannot read the image. This security mechanism was preserved; no weaker bypass was introduced. Real assistive-technology and human usability testing remain useful before public launch.

## Final implementation and verification

- Saved rooms are first, with search by room name, description or invitation code. Account nicknames are reused; creation, joining, restoration and all four templates remain available.
- Overview, rooms and templates have explicit active navigation. Template deep links use the existing root/hash route, so deployment rewrites are unchanged. Returning from Planning to Topology now always selects the requested view, including when a Simulator was previously open.
- The shared light theme covers account, room management, templates, canvas, device catalog/inspector, planning, IPv6, simulation, CLI and collaboration. Presentation mode is preserved, with an explicit return to editing.
- Native dialogs provide names, Escape and focus restoration for settings, imports, recovery, deletion and unsaved drafts. Destructive ACL and planning actions now require confirmation; a changed ACL rule cannot be deleted under an outdated confirmation.
- Mobile panels open one at a time, hidden panels are inert, selection opens the inspector and dismissal returns focus. The editor frame cannot scroll sideways when focus moves during a panel transition.
- Planning tables become labeled records on phones while preserving all columns, controls and results. No page overflow was found at 320, 390, 600, 768, 1024 or 1440px.
- Production build passes. Full server suite: **108 passed, 1 skipped**. Cloud suite: **14 passed**. Final frontend suite: **90 passed**. The existing skipped test requires an actual local Probe environment.
- Automated axe checks reported **zero violations** across 20 inspected desktop/mobile screen states; device catalog, deletion and CAPTCHA dialogs were also checked. Keyboard selection, native modal containment/Escape, device creation, deletion/Undo/Redo, Cisco commands, a successful packet scenario, planning calculation/save/draft protection, mobile navigation, room creation and template reload were exercised in the isolated browser.
- No production deployment, real-network scan or cross-device microphone call was performed. Existing role enforcement, account persistence, sync, worker-based CLI, exports, scenarios and API behavior remain covered by regression tests.
