# dsh-v-cosmos · V Cosmos

[简体中文](README.md) | **English**

A galaxy visualization plugin for DSH Web — and a console for openspec proposals.

Workspaces are constellations, active proposals are stars, sessions are planets / comets,
subagents are satellites, archived changes are nebulae. Style D (HUD over a procedural
galaxy): one page answers **what my universe looks like right now** and **which proposal
to act on next**.

Purely additive: it replaces or disables nothing from the official set, and is always
read-only toward openspec artifacts (sole exception: the user-clicked "Dismiss embryo",
which deletes a single anchor).

## Features

| Capability | Description |
|---|---|
| **Galaxy view** | Constellation = workspace; star = active proposal; planet = proposal session; comet = free session; satellite = subagent; nebula = archived changes (density = count) |
| **Dual encoding** | Star color = proposal lifecycle (proto-star dashed outline / created / reviewed with seal ring / executed gold), heat = active session count; planet color = four-state session status (idle / running / pending decision / completed unread) |
| **Console** | Left proposal panel + bottom action bar: pick a proposal, then send "prompt + `@proposal dir`" into a fresh session in that workspace — optional auto-send, model binding, per-button jump-after-execution |
| **In-place actions** | Info cards: open session, archive session (running work is skipped, never stopped), dismiss embryo (two-click confirm, removes only the anchor file) |
| **Navigation** | 1.3s dive-in from a constellation chip / star, layered Esc; search filter; WASD pan (Shift boost), wheel / pinch zoom, drag-pan toggle |
| **Look & config** | 12 built-in skins; six settings tabs (General / Quick actions / Constellation actions / Skins / Interface / Shortcuts); configurable global keys and UI sizes |
| **Split pane** | Dock Cosmos in the DSH right sidebar beside the conversation; actions keep full semantics in the same window (fresh session / explicit binding / model switch / auto-send), identically on web and desktop |
| **Zero intrusion** | Always read-only toward `openspec/` (sole write exception: the user-clicked embryo dismissal; zero-write asserted by smoke suites); no official DSH package is modified |

## Installation

Prerequisites: a running DSH web profile; Node.js and pnpm.

```bash
# 0. Get the code (any directory)
git clone <repo-url> dsh-v-cosmos
cd dsh-v-cosmos

# 1. Build (lib/ is not committed)
npm install && npm run build

# 2. Register into the web profile — edit $DSH_HOME/profiles/web/package.json:
#      dsh.profile.bundles  append  "dsh-v-cosmos"
#      dependencies         add     "dsh-v-cosmos": "link:<absolute repo path>"
pnpm install --dir "$DSH_HOME/profiles/web"

# 3. Restart the host
dsh web
```

Verify: `dsh --profile web --dump-config` should contain `- id: dsh-v-cosmos`. After the
restart, the **Cosmos** entry appears at the bottom of the sidebar. Restart the host after
upgrading the plugin.

## Usage

- **Entry & camera**: the sidebar "Cosmos" button opens the full page; drag to rotate
  (pan when drag-pan is on), wheel / pinch to zoom (pointer-centered), WASD to pan
  (Shift boost), Space to open the selected session.
- **Dive & back**: click a constellation chip or star to dive in; Esc is layered (back to
  galaxy → exit fullscreen → close page), the bottom-right "Back to galaxy" button does
  the same; the four global keys (back to galaxy / pan toggle / voice toggle / close page)
  are configurable in settings.
- **Proposal panel**: clicking a card selects it and flies to its star; clicking outside
  the panel clears the selection; Esc inside the panel only blurs it.
- **Action bar**: disabled until a proposal is selected. A click runs "create session →
  message = prompt + `@proposal dir` → optional auto-send → jump or stay per button
  config". The fresh session gets its own draft; existing sessions and drafts are never
  touched.
- **Info cards**: planet / comet cards carry "Open session" and "Archive session"; embryo
  cards carry "Dismiss embryo"; satellites have no card.

## Configuration

| Location | Content |
|---|---|
| Settings → Cosmos | Launch mode, quick-action / constellation-action buttons, skins, interface sizes and zoom, shortcuts |
| `$DSH_HOME/dsh-v-cosmos.config.json` | Action-button shared config (`GET/PUT /api/dsh-v-cosmos/config`; CAS writes + backup rotation + hot reload) |
| `localStorage["dsh-v-cosmos:settings"]` | Page preferences (skin / pan speed / zoom focus / UI sizes / key bindings) |

Button config example:

```json
{
  "revision": 1,
  "buttons": [
    { "name": "Review", "prompt": "Please review this proposal with /cosmos-review", "autoSend": true, "newSession": true, "prepend": true },
    { "name": "Execute", "prompt": "Please run /cosmos-apply-change on tasks.md", "autoSend": false }
  ]
}
```

`name` / `prompt` required; `autoSend` defaults to `false`; `newSession` is always `true`;
`prepend` puts the prompt before the `@` reference; `model` optional
(`{ provider, model, reasoningEffort? }`, switched before sending). Up to 32 buttons.

> Upgrade note: button configs are normalized and persisted by the host half — restart
> the host after upgrading the plugin (an old host drops newly added fields).

## Data & boundaries

- **Galaxy skeleton**: the host scans each workspace's `openspec/` (`GET /scene`);
  `fs.watch` triggers incremental rescans and SSE broadcasts keep tabs in sync.
- **Session facts**: from the official mirror (`ctx.sessions.list` /
  `ctx.workspaces.list`) plus the unified session status snapshot; four-state status,
  satellite parent chains and layout are all derived client-side.
- **Proposal lifecycle**: from the contract files
  `openspec/changes/<name>/.state.json` and `openspec/pending-changes/<slug>.json`
  (missing / invalid falls back to "created"); they travel with the proposal directory
  across devices. Contract definition: [cosmos-spec/CONTRACT.md](cosmos-spec/CONTRACT.md).
- **Session↔proposal association**: stored in `$DSH_HOME/storages/dsh-v-cosmos.json`;
  explicit binding wins (declared by skills and the button pipeline), heuristics
  (slug mentioned in context / unique active session within ±30min of the directory)
  fall back; archiving a session prunes its edges, archiving a proposal keeps them.

Host endpoints live under `/api/dsh-v-cosmos/` (loopback, same port as the UI):

| Endpoint | Purpose |
|---|---|
| `GET /scene` | Galaxy skeleton (constellations / star lifecycles / nebulae / edges) |
| `GET /events` | SSE light-frame broadcast (proposal / association changes) |
| `GET/PUT /config` | Action-button shared config (CAS writes) |
| `POST /archive-sessions` | Batch archive sessions (skip running work, per-session outcomes) |
| `POST /rename-session` | Prefix rename (session sweep) |
| `POST /bind-session` | Explicit session↔proposal binding (replace semantics, idempotent) |
| `POST /dismiss-embryo` | Dismiss a pending anchor (guarded, user-click only) |

## Development

```bash
npm run build   # esbuild browser half + host half direct-out (lib/)
npm run check   # node --check over all artifacts
npm test        # 25 node smoke suites
```

```
src/index.mjs     host half: routes / SSE / fs.watch / association engine / config channel
src/client.jsx    browser half: full page / panel / action bar / settings wiring
src/cosmos/       render engine, style-D skin and skin registry
src/*.mjs         pure logic: scan / merge / panel / actions / associations / sweep / shortcuts / config store
test/             node smoke suites (25)
```

`lib/` (build output), `demo/`, `openspec/`, `docs/`, `.trae/`, `.dsh-v-explorer/` are not
committed; committed = `src/`, `test/`, `build.mjs`, `package.json`, `cordis.patch.yml`,
`cosmos-spec/`, both READMEs and the LICENSE.

## License

MIT
