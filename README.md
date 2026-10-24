# OxHackSpeedRun

Our entry for **OxHack 2026**, Oxford: 350 hackers, 2 days, **25 hours of hacking**. The clocks go back during the event, so we get an extra hour.

> **Theme: TIME**

## The project

_Draft. This section becomes the Devpost writeup._

- **What it is:** an assembly IDE, debugger and CPU visualiser for a **reversible computer**: a machine where every instruction can be run backwards (ISA in [spec/SPEC.md](spec/SPEC.md)).
- **How it uses the theme (TIME):** a step-back debugger that moves through machine time with **no history log**, plus a classic logging debugger to compare against.
- **Tracks we're targeting:** see [Prize tracks](#prize-tracks).
- **Stack:** Vite + React + TypeScript.
- **Team:**

### Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # assembler + VM tests (both engines, step-back exactness, oracle)
npm run build      # type-check + production build
```

Then **drag a `.s` file onto the page**. That is the only way to load a program. Examples are in [examples/](examples/):

| File | Shows |
|---|---|
| `multiply.s` | a loop with `br`/`lnd` |
| `fibonacci.s` | reversible update `(a, b) → (b, a + b)`, writing to memory |
| `cipher.s` | XOR cipher: run it, flip to **Inverse**, run again to decrypt |
| `draw.s` | the 64×32 display; stepping back erases pixels |
| `procedures.s` | nested `call`/`proc`/`ret` and the call stack |
| `bad-landing.s` | a wrong `lnd` the oracle catches; open **Comparison** to see the engines disagree |

### The UI

- **Visualiser tab:**
  - Left: an assembly IDE.
    - Files open as tabs, with live assembly as you type and problems shown in the gutter and the Problems panel. Saving (⌘/Ctrl+S) writes back to the dropped file in Chrome and downloads it elsewhere.
    - **Classic debugger:** run, pause, step into, step over, run to cursor, restart, breakpoints (F9).
    - **Step-back debugger:** go to start, reverse run, step back, run, step, run to end, a timeline scrubber, a direction flip (run the program as its own inverse), and a choice of engine.
  - Right: an LMC-style CPU diagram (code memory, control unit, ALU, registers, history log, data memory, 64×32 display). Buses animate each step: teal forwards, amber backwards.
- **Comparison tab:** the same file on the **classic logging VM** and the **new reversible VM** side by side, in lockstep, with a live check that they agree.

### How it works

- [src/asm/](src/asm/): the assembler (`spec/asm_syntax.md` → `.rvm` image). It rejects irreversible operand pairs and broken `br`/`lnd`/`call`/`proc` structure.
- [src/vm/](src/vm/): both engines behind the team's `RVM` interface (`spec/vm_api.ts`).
  - The **reversible VM** steps back by computing inverses (SPEC section 6) and keeps no per-step history.
  - The **logging VM** stores a delta per step. It is also the oracle that checks every landing.
- [src/state/](src/state/): debugger sessions (one VM in the IDE, two in lockstep for Comparison) and the app store.

---

## Key times

All times are UK time. The clocks go back from BST to GMT at 02:00 on Sunday.

| When | What |
|---|---|
| Sat 12:00 | **Hacking begins** (team building 12:00–12:15) |
| Sat 15:00–16:00 | HRT talk: Matt Godbolt, *What 25 Days of Optimizations Taught Me About Compilers* (L1) |
| Sat 17:30–18:00 | MLH Workshop 1: Google AI Studio (C1) |
| Sat 19:00–19:30 | MLH Workshop 2: GitHub Copilot (C1) |
| Sat 20:30–21:00 | Hackathons UK mini event (cup stacking) (C1) |
| Sun 00:00–00:30 | HRT midnight pizza |
| Sun 09:00–10:00 | Devpost submission workshop (C1) |
| **Sun 12:00** | **Hacking finishes. Submit on Devpost before this.** |
| Sun 13:00–15:45 | Judging (all hacking spaces) |
| Sun 16:00–16:45 | Closing ceremony (L1) |

Meals and drops are at the Food Collection Point: lunch Sat 13:00, Citadel bubble tea Sat 14:00, dinner Sat 18:00, breakfast Sun 08:00, lunch Sun 12:00.

## Prize tracks

### Sponsor challenges

| Sponsor | Challenge | What they want |
|---|---|---|
| **Hudson River Trading** | Best use of data for predictions & decision making | Real data driving a prediction or a decision. |
| **Citadel** | Best Handmade Project | Get creative and learn something new. |

We are not entering the Zed ("Built with Delta") track.

### MLH tracks

All at [mlh.link/oxhack](https://mlh.link/oxhack).

| Track | Prize | Link |
|---|---|---|
| Best use of Gemini API | MLH + DEV swag bags | [mlh.link/gemini](https://mlh.link/gemini) |
| Best use of ElevenLabs | Beats Solo earbuds | [mlh.link/elevenlabs](https://mlh.link/elevenlabs) |
| Best use of Tiger Data (Postgres) | Stream Deck Mini | [mlh.link/tigerdata](https://mlh.link/tigerdata) |
| Best use of Snowflake API | Arduino kits | [mlh.link/snowflake](https://mlh.link/snowflake) |
| Best use of Solana | Assorted | [mlh.link/solana](https://mlh.link/solana) |
| Best use of Presage (camera biometrics) | Fitbit Inspires | [mlh.link/presage](https://mlh.link/presage) |
| Best use of Vultr | Portable screens | [mlh.link/vultr](https://mlh.link/vultr) |
| DEV writing challenge (post-event blog) | $100 | [dev.to/mlh-hackathon](https://dev.to/mlh-hackathon) |

Also from MLH: the hardware lab ([mlh.link/hardware](https://mlh.link/hardware)), Gemini API keys ([mlh.link/aistudio](https://mlh.link/aistudio)), and "I Demoed" stickers for demoing on Sunday.

## Useful links

- Event hub: [mlh.link/oxhack](https://mlh.link/oxhack) · MLH hack resources: [hack.mlh.com](https://hack.mlh.com)
- GitHub Student Developer Pack: [gh.io/oxhacks26](https://gh.io/oxhacks26)
- Code of conduct: [MLH](https://github.com/MLH/mlh-policies/blob/main/code-of-conduct.md) · [Hackathons UK](https://www.hackathons.org.uk/code-of-conduct/)
- Announcements: event Discord
- Source material: [docs/opening-ceremony-slides.pdf](docs/opening-ceremony-slides.pdf), [docs/sponsors_notes.txt](docs/sponsors_notes.txt)

## License

[MIT](LICENSE)
