# dsh-v-cosmos · V Cosmos

[简体中文](README.md) | **English**

A **galaxy visualization plugin for DSH Web**: workspaces are constellations, active
proposals (openspec changes) are stars (color = proposal lifecycle, heat = active session
count), openspec sessions are planets (four-state session status), free sessions are
comets, subagent sessions are satellites (orbiting their parent body), and archived
changes form nebulae (density = count). Style D — a HUD over a procedural galaxy —
answers one question: **what does my universe look like right now, and where do I need
to be**.

Purely additive: it replaces or disables nothing from the official set, and is always
read-only toward openspec artifacts.

Since v0.2 it is also a **console**: select a proposal in the left panel, then the
bottom action bar sends "prompt + @proposal directory" into a fresh session of that
proposal's workspace (auto-send the first turn, optional model binding) —
**observe → act → status flows back as color**, all on one page.

## Celestial language

| Body | Meaning | Visual encoding |
|---|---|---|
| Constellation | Workspace | Fibonacci shell 3D layout |
| ✦ Star | Active proposal | **color = lifecycle four-state** (pending-creation proto-star / created / reviewed / executed); heat channel = act (white-hot core + cross flare) |
| ● Planet | Proposal-bound openspec session | orbits its star; **color = session four-state** (idle / running / pending-decision / completed-unread) |
| ◇ Satellite | Subagent session | dashed sub-orbit ring around its parent; desaturated own state; max 6 visible per parent (extras folded into the parent card) |
| Binary | One session, several proposals | circumbinary orbit around the shared mass center |
| ☄ Comet | Free session | drifts on the constellation fringe, tail = recent activity; may carry satellites |
| ☁ Nebula | Archived changes | dust density = archive count (cap 520 particles) |

Counting gauges are tiered: the galaxy view chips show only constellation names; after
diving into a constellation, its plaque at the top center shows full counts
(`✦ stars ● planets ◇ satellites ☄ comets ☁ nebulae`). Gold dashed lines inside a
constellation = proposal associations (derived from shared sessions). Blank sessions and
sessions without a workspace are not rendered.

## Entry points

- The "**Cosmos**" button at the bottom of the sidebar (between Hive and Token stats)
  opens the full-page app; the page edge tracks the sidebar edge.
- Esc layering: dive-out > exit fullscreen > close page; dive-in is a 1.3s flight on
  clicking a constellation chip / star; the "**Back to galaxy**" button (bottom right,
  touch-friendly) or Esc flies back.
- HUD: no breadcrumbs, no top-right hints — galaxy state has the search box at top
  center; dive state shows the constellation plaque instead.
- Hover a body → HUD info card; planet/comet cards carry two buttons: **Open session**
  (closes the page, switches to the official session page) and **Archive session**
  (in-place archival, page stays open). Satellites have no info card.
- Drag to rotate / wheel zoom / **pinch zoom** (same range, no dead zones over overlays)
  / **WASD pan** (fixed speed, Shift boost, never hijacks focused inputs); multi-touch
  gestures suppress clicks for 350ms after they end.
- Bottom-left "**+**" button (44×44) → create a workspace; the render loop pauses when
  the page closes or the tab goes hidden.

## Proposal actions (console)

- **Left proposal panel** (187px): grouped by workspace (title = constellation name),
  lexical order inside; workspaces without active proposals are hidden in galaxy state.
  Card colors mirror the star lifecycle; shows tasks `x/y`, `setBy`, `at`. Clicking a
  card = **select + focus flight** ("take me to that star"); clicking outside the
  panel/bar/search clears selection. The panel is a native scroll region: WASD does not
  hijack the camera while it is focused, Esc just blurs.
- **Bottom action bar**: centered below the panel, 8 equal-width buttons per row,
  wrapping at a 32-button cap; disabled and dimmed until a proposal is selected. Wheel
  over the bar zooms the camera (no threshold navigation) and converges toward the
  pointer.

Click pipeline ("new session" is locked on + per-button "jump after execution"):

1. Compose the message: `@<proposal dir>` = `@` + `<workspace>/openspec/changes/<name>`;
   `prepend` = prompt first, otherwise the @-reference first.
2. Create a **fresh** blank session via official `ctx.sessions.create({ workspaceId })`,
   register a one-shot marker bound to the new session id, then navigate with
   `uiWorkspace.openSession`. Existing sessions and their drafts are untouched. With
   "jump" enabled the Cosmos page closes and the session appears; otherwise the page
   stays open over the new session and a toast confirms.
3. The new session's composer hero consumes the one-shot marker: validates the session
   id matches, deposits the draft via `inputActions.setDraft` (never overwrites a
   non-empty draft), and — with **auto-send** checked — submits the first turn once
   (switching the bound model first; failures toast without blocking). Markers expire
   after ~10s (expired = nothing deposited, nothing sent, no user content lost).
4. Fallback: if `sessions.create` is unavailable, fall back to official
   `uiWorkspace.startSession(workspace, { prompt })` with a degradation toast.

## Configuration

### Page settings (localStorage)

Persisted at `localStorage["dsh-v-cosmos:settings"]`:

| Key | Default | Range | Meaning |
|---|---|---|---|
| `panSpeed` | `120` | `[20, 600]` | WASD base pan speed (world units/s, fixed) |
| `panShiftBoost` | `3` | `[1, 10]` | Shift boost multiplier |
| `skin` | `rosepine` | 12 built-in skin ids | HUD theme skin (unknown ids fall back) |

Factory defaults live in `src/settings.mjs` (`COSMOS_SETTINGS_DEFAULTS`).

### Action buttons (shared config store)

Button configuration lives in the plugin-owned shared file
**`$DSH_HOME/dsh-v-cosmos.config.json`** (fully independent from the association store
`storages/dsh-v-cosmos.json`):

```json
{
  "revision": 3,
  "buttons": [
    {
      "name": "Review",
      "prompt": "Please review this proposal with /cosmos-review",
      "autoSend": true,
      "newSession": true,
      "prepend": true,
      "model": { "provider": "deepseek", "model": "deepseek-chat", "reasoningEffort": "max" }
    }
  ]
}
```

- `name` required (trimmed, deduplicated); `prompt` required (≤ 20000 chars);
  `autoSend` default `false`; `newSession` is locked to `true`; `prepend` optional
  (prompt before the @-reference); `model` optional, passed through as-is (model
  switches before sending).
- Cap 32 buttons; every write rotates `.bak.1~3` backups, uses temp-file + atomic
  replace inside a cross-process lock (≈1s wait → HTTP 503); concurrent writes arbitrate
  by `revision` CAS (first writer wins, loser gets 409); a corrupt main file is restored
  from `.bak.1 → .bak.2 → .bak.3`.
- Host `fs.watch` hot reload: hand-editing the file updates open settings pages and the
  Cosmos action bar within seconds.
- Channels: plugin API `GET/PUT /api/dsh-v-cosmos/config` first; host `settingsScope` /
  `configForms` as fallback; if all three are unreachable, degrade to read-only
  (action bar not rendered, settings page shows a notice, plugin activation unaffected).

### Settings page

**Settings → Cosmos → Quick actions**: add/remove/edit button rows (name, prompt,
auto-send, prompt-first, jump-after-execution, locked "new session" badge, model and
effort dropdowns), drag handle + up/down ordering, staged save ("discard changes"
restores the draft; "reset to composed layer" appears when a user-layer override
exists). Model candidates share the session model menu source (official
`remote.session.modelCatalog`); effort defaults to max. Row order = display order;
changes hot-apply on save.

> **Upgrade note**: button configs are normalized by the host half
> (`normalizeButtons`). After upgrading the plugin, **restart the DSH host** (a page
> refresh is not enough) — an old host silently drops the newer `jumpNewSession` key,
> which shows up as "unchecking 'jump after execution' re-checks itself on save".

## Data & associations (rules core)

- **Galaxy skeleton** (stars / nebulae / edges / pending anchors) is scanned by the host
  half from each workspace's `openspec/` (`GET /api/dsh-v-cosmos/scene`); fs.watch on
  the `openspec/` root provides incremental updates + SSE light-frame broadcast across
  tabs.
- **Session facts** come 100% from the browser half's official mirror
  (`ctx.sessions.list` / `ctx.workspaces.list`); four-state signals come from the
  unified session status snapshot (`ctx.uiSession.sessionStatus`), degrading to
  idle/busy when unavailable; satellite parent chains derive from mirror
  `origin`/`parentSessionId`. All state derivation happens client-side.
- **Proposal lifecycle** comes from two on-disk contract files (read-only for the
  renderer): `openspec/changes/<name>/.state.json` (created/reviewed/executed) and
  `openspec/pending-changes/<slug>.json` (pending-creation anchor); missing/invalid
  falls back to "created" and states travel with the proposal directory across devices.
- **Session↔proposal association** lives in the plugin's own store
  `$DSH_HOME/storages/dsh-v-cosmos.json`: rule 1 — the session belongs to the workspace
  and its recent context mentions the proposal slug; rule 2 — a unique active session
  within ±30min of the proposal directory's appearance. Idempotent; archiving a session
  prunes its entry, archiving a proposal keeps the edge (planets return to comets).
- **Zero-intrusion discipline**: workspace directories are always read-only; the plugin
  MUST NOT write any openspec artifact (asserted by the
  `test/zero-pollution-smoke.mjs` suite — `openspec/` byte-identical before/after and
  `openspec list/status/validate` output unchanged); no official DSH package is
  modified.
- **Session sweep**: the archive skill drives host session state through two generic
  endpoints — `POST /archive-sessions` (batch archive proposal-associated sessions;
  running turns / subagent chains / jobs / schedules are **skipped, never stopped**;
  idempotent for already-archived) and `POST /rename-session` (prefixes the sweeper's
  own title with `archived-`; the sweeper never archives itself).

## Host endpoints

The host half serves under `/api/dsh-v-cosmos/` (loopback, same DSH Web port; no
separate auth):

| Endpoint | Purpose |
|---|---|
| `GET /scene` | Galaxy skeleton JSON (constellations / star lifecycles / nebulae / edges) |
| `GET /events` | SSE light-frame broadcast (`proposals-changed` / `associations-changed`) |
| `GET/PUT /config` | Action-button shared config (CAS writes: 200 / 409 / 400 / 503 / 500) |
| `POST /archive-sessions` | Session sweep: batch archive `{sessionIds}` (dedup ≤32, sequential, no stopActivity, per-session outcomes, always 200) |
| `POST /rename-session` | Session sweep: prefix rename `{sessionId, prefix}` (empty titles fall back, idempotent, host-truncated) |

## Development

```bash
npm install
npm run build   # esbuild browser half + host half direct-out (lib/ is gitignored)
npm run check   # node --check over all artifacts
npm test        # 21 node smoke suites (scan / associations / button schemas /
                #   config store / merge / panel projection / action pipeline /
                #   settings controller / client UI / in-place archive / engine /
                #   render / factory / zero-pollution / cross timing / host wiring /
                #   sweep logic + wiring / skin registry)
```

**Build outputs and local directories are not committed**: `lib/`, `demo/`,
`openspec/`, `cosmos-spec/`, `docs/`, `.trae/`, `.dsh-v-explorer/` are all in
`.gitignore`. Committed content = `src/`, `test/`, `build.mjs`, `package.json`,
`package-lock.json`, `cordis.patch.yml`, `README.md`, `README.en.md`, `.gitignore`,
`LICENSE`. After cloning, run `npm install && npm run build` first (install step 1
above); `npm run check` verifies the artifacts exist.

```
src/index.mjs            host half: routes / SSE / fs.watch / heuristic engine /
                         association store / button config channel
src/scan.mjs             pure logic: proposal scan / lifecycle / anchors / skeleton
src/associations.mjs     pure logic: association normalize / idempotent writes / cap
src/sweep.mjs            pure logic: session sweep (normalize / outcomes / prefix)
src/buttons.mjs          pure logic: action-button normalization
src/configstore.mjs      shared config store (CAS + backups + atomic replace + watch)
src/client.jsx           browser half: seat / overlay page / panel / action bar / hero
src/api.mjs              browser API bridge (scene fetch / SSE)
src/merge.mjs            pure logic: skeleton×mirror merge / four-state / satellites
src/panel.mjs            pure logic: proposal panel projection
src/actions.mjs          pure logic: message compose / marker consume / execution
src/session-archive.mjs  pure logic: in-place archive outcomes → copy
src/model-catalog.mjs    pure logic: model catalog (effort default max / drift)
src/settings-seam.mjs    client settings channel (API / settingsScope / configForms)
src/button-settings.mjs  pure logic: settings-page "Quick actions" controller
src/settings-ui.jsx      settings page "Cosmos" section + "Quick actions" tab (React)
src/cosmos/engine.mjs    render engine (states / satellites / transitions / HUD)
src/cosmos/skin-d.mjs    style-D skin (state seal / planet halo / satellite drawing)
src/cosmos/skins/*.mjs   12 built-in skins via the skin registry
```

## License

MIT
