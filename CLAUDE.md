# CLAUDE.md

## Context
This repo is our entry for OxHack 2026 (Oxford, theme **TIME**). Hacking ends at **12:00 on Sunday 25 Oct** (UK time),
and the Devpost submission must be in by then. Judging runs 13:00–15:45, and judges walk round to see a live demo.
Event details, schedule and prize tracks are in `README.md`. The source material is in `docs/`.

## Project
A web IDE for the team's **reversible computer** (ISA, memory map and API are in `spec/`, copied from the
team repo `Hello-Atharv/OxHack`). It has an assembly editor with two debugger modes (classic, and step-back
with time travel) and an LMC-style CPU visualiser. A Comparison tab runs the classic logging VM and the reversible VM side by side.

- Stack: Vite + React + TypeScript. `npm run dev`, `npm test` (vitest), `npm run build` (runs `tsc --noEmit` first).
- Programs load **only by drag-and-drop** of a `.s` file. Never add built-in programs or a file picker. Examples
  live in `examples/`, and `src/vm/vm.test.ts` runs all of them.
- `src/asm/` assembler, `src/vm/` engines (`ReversibleVm`, `LoggingVm`, both implementing `RVM` from
  `spec/vm_api.ts`), `src/state/session.ts` (one or more VMs in lockstep), `src/state/store.ts` (files, tabs).
  UI talks to VMs only through `Session`. When the team's WASM VM lands, it replaces `createVm` in `src/vm/vms.ts`.
- `npm test` must stay green. It checks that stepping back exactly undoes stepping forward, that both engines
  agree at every t, and that the oracle faults on `bad-landing.s`.
- Layout: `src/ui/ide/` (tabs, editor, toolbar, timeline, bottom panels), `src/ui/viz/` (CPU SVG diagram,
  display), `src/ui/compare/`. Colours are CSS variables in `src/styles.css`: teal = forward, amber = inverse.
- Note: recent Chrome makes `scrollTo`/`scrollIntoView` return a Promise. Never return one from a
  `useEffect` arrow (always use a block body).

## How to work here (hackathon mode)
1. **A working demo beats unfinished features.** Keep `main` demoable at all times. Build the thinnest
   end-to-end slice first, then add depth. Prefer boring, well-known tools over new setup.
2. **Optimise for what judges see.** A snappy, polished demo beats a long feature list. HRT rewards real
   data used for prediction or decisions; Citadel rewards a creative, handmade project.
3. **Connect the work to the theme (TIME)** and to whichever tracks we target. When a choice can earn a
   track as well (e.g. Gemini, ElevenLabs, Tiger Data, Snowflake, Vultr), say so. Never bolt one on in a
   way that breaks the demo.
4. **Mock first, then make it real.** If a dependency (API, dataset, teammate's component) is not ready,
   stub it behind the same interface so others are not blocked.
5. **Be honest in the writeup.** Never claim novelty or performance we haven't shown. Label mocked or
   precomputed parts as such in the demo.
6. **Watch the clock.** Sunday 09:00 means freeze features and fix only. 11:00 means the Devpost
   submission is drafted, with video or screenshots ready.

## Conventions
- Secrets go in `.env` (gitignored). Never commit API keys. Add a `.env.example` listing the variable names.
- Small, frequent commits on short-lived branches (`<name>/<topic>`), merged to `main` quickly. Do not
  rewrite shared history.
- Update `README.md` run instructions whenever setup changes, so any teammate or judge can run it.
- Keep large binaries out of git apart from what is already in `docs/`.
- Do not use Zed or Delta.
