# Modding Undercut: content packs

A **content pack** changes how the game *looks and sounds*: team and driver names, colours, liveries, the people of the pit wall and a few
sounds. It is a folder of data and assets. A pack can never run code, and it can never change the race: the engine knows teams and
drivers only by their stable ids (`VMR`, `ALD`, ...), and the pack decides what those ids look like.

The game ships one pack, the **base pack** (`client/public/packs/base-fictional/`), with original, fictional content. This repository
also holds one example mod, **Neon Harbour** (`mods/examples/neon-harbour/`), which you can copy.

> **Real names, logos and liveries never go in this repository.** If you make a pack with real team or driver names, put it in
> `mods/local/` (or the per-user folder below). Both are ignored by git, and a pre-commit check refuses to commit anything under
> `mods/local/`. Turn the check on once with `git config core.hooksPath .githooks`. The project does not ship, recreate or approximate real
> liveries, logos or likenesses; a pack you make for yourself is yours to answer for.

## Quick start

From `client/`:

```
npm run mods:init -- my-pack --name "My pack"     # creates mods/local/my-pack/manifest.json with every team and driver id
# edit mods/local/my-pack/manifest.json ...
npm run mods:validate -- mods/local/my-pack       # prints OK, or every problem it finds
npm run dev                                       # then Packs > My pack (or the Packs button on the landing page)
```

While `npm run dev` is running, saving a file under a mods folder reloads the packs in the page by itself (hot reload). Use **Packs >
Reload packs** if you add a folder.

## Where packs are looked for

| Source | Folder | Notes |
|---|---|---|
| base | `client/public/packs/base-fictional/` | built in, always loaded first |
| `examples` | `mods/examples/<folder>/` | in the repository |
| `local` | `mods/local/<folder>/` | ignored by git: for your own packs |
| `user` | `$XDG_DATA_HOME/undercut/mods/` (`~/.local/share/undercut/mods/`), `~/Library/Application Support/undercut/mods/` on macOS, `%APPDATA%\undercut\mods\` on Windows | ignored by git by being outside it |

Each pack is one folder. Only the pack you choose in **Packs** is used, on top of the base pack: ids the mod does not mention keep the base
pack's look, and ids nobody mentions get a generated identity (`Team XYZ`, a colour made from the id), never a crash and never a real name.

Both the development server (Vite) and the game server (`server/mods.py`, also in the packaged app) list and serve the packs through the same
two routes: `/mods/index.json` and `/mods/<source>/<folder>/<file>`. Mods therefore work without the development server: put a pack folder in
the `user` folder (set `UNDERCUT_MODS` to use another one), start the game and open **Packs**; **Reload packs** picks up changes (there is no
automatic hot reload outside development). The game server only checks that a manifest can be read and is a mod; the page runs the full
validation (limits, file signatures, schema, unsafe SVG) when it loads a pack, and a pack that fails is listed with the reasons. The packaged
app does not contain `mods/`: it finds packs in the `user` folder only, and `mods/local/` must never be added to it.

## What may be in a pack folder

Only `manifest.json` and files under `assets/`. Everything else is refused.

| Type | Extension | Limit |
|---|---|---|
| manifest | `manifest.json` | 262144 bytes (256 KB) |
| bundle (optional) | `bundle.json`, a parameter bundle the server may use for this pack (set `UNDERCUT_PACK_BUNDLE` to the pack's folder name); the page never reads it | 2097152 bytes (2 MB) |
| image | `.png`, `.webp` | 2097152 bytes (2 MB), 4096 px per side |
| vector image | `.svg` | 204800 bytes (200 KB), no scripts, no external links |
| sound | `.ogg`, `.wav` | 1048576 bytes (1 MB), 20 seconds (checked for `.wav`) |
| whole pack | | 25165824 bytes (24 MB), 400 files |

The checks are on the bytes, not just the name: a file called `a.png` that is not a PNG is refused. Paths must be relative with forward
slashes: no `..`, no absolute paths, no drive letters, no empty or `.` segments, no NUL or control characters, and **no symbolic links**.
An SVG is refused (never repaired) if it contains `<script>`, `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`, `<audio>`, `<video>`,
animation elements, `<!DOCTYPE>` or `<!ENTITY>`, an `on...=` attribute, a `javascript:` URL, an `href` that is not a `#fragment`, or CSS
with `@import` or an external `url(...)`.

## The manifest

`schema` is `1`. Unknown keys are errors (so a typo is caught), and every value is range-checked. The schema is
`client/src/packs/pack.schema.json` (JSON Schema 2020-12); this table is the same thing in words.

### Top level

| Key | Type | Notes |
|---|---|---|
| `schema` | `1` | required |
| `id` | string | required; `[a-z0-9-]`, 3 to 40 characters; must differ from every other pack's id |
| `name` | string | required; 1 to 80 characters |
| `version` | string | required; `major.minor.patch`, like `1.0.0` |
| `author` | string | required; 1 to 80 characters |
| `licence` | string | required; 1 to 80 characters, for example `CC0-1.0` |
| `kind` | `"mod"` | required; only the built-in pack has `"base"` |
| `teams` | object | team id to team (below); up to 64 |
| `drivers` | object | driver id to driver (below); up to 256 |
| `archetypes` | object | archetype id to archetype (below); up to 64 |
| `sounds` | object | sound name to a path under `assets/` (below) |
| `circuits` | object | optional; circuit id (lowercase letters, digits, underscores) to `{ "displayName": "..." }` |
| `tracks` | object | reserved for track skins: must be empty |

Team and driver ids are the ones in the parameter bundle (`VMR`, `ALD`, ...): 2 to 12 capital letters, digits or underscores. Archetype ids
are yours: lowercase letters, digits and dashes, 2 to 32.

### Team (`teams.<ID>`)

| Key | Type | Notes |
|---|---|---|
| `displayName` | string | required; shown in the scene; 1 to 80 characters |
| `short` | string | required; 2 to 4 capital letters or digits |
| `colours` | object | required: `primary`, `secondary`, `accent`, each `#rrggbb` |
| `livery` | object | required: `pattern` and optionally `image` (below) |
| `crew` | object | required: `kit` (the crew's clothes) and `helmet`, each `#rrggbb` |
| `engineers` | list | optional; up to 8 archetype ids for the engineers and the strategist |

`livery.pattern` is one of `solid`, `stripe`, `chevron`, `split`, `hoops`, `diagonal`, `dots`: the car is painted in `primary` with the
pattern in `secondary` and trim in `accent`. `livery.image` is optional, a path like `assets/car.png`, drawn over the car's side (clipped to
its body) when it passes the pit wall. A transparent PNG with the pattern you want works best; the top-down map and scene use the pattern
only.

### Driver (`drivers.<ID>`)

| Key | Type | Notes |
|---|---|---|
| `displayName` | string | required |
| `short` | string | optional; 2 to 4 capital letters or digits, the code on the timing screens (default: the first three letters of the surname) |
| `number` | integer | required; 1 to 99; drawn on the car |
| `archetype` | string | required; the id of an archetype with role `driver` |
| `helmet` | object | required: `primary` and `secondary` (`#rrggbb`) and `pattern` (as for liveries) |

### Archetype (`archetypes.<id>`)

People are archetypes, not portraits: a build, a height, a hairstyle and a skin tone. They are drawn as vector figures in the team's
colours.

| Key | Type | Notes |
|---|---|---|
| `role` | string | required; `crew`, `engineer`, `strategist` or `driver` |
| `build` | string | required; `lean`, `medium` or `broad` |
| `height` | number | required; 0.9 to 1.1 |
| `hair` | string | required; `none`, `short`, `long`, `curly`, `cap` or `tied` |
| `skin` | string | required; `#rrggbb` |

The crew take the archetypes with role `crew`, in order; the engineers take the team's `engineers` list (or the archetypes with role
`engineer`); the strategist takes the first `strategist`; each driver uses their own `archetype`.

### Sounds (`sounds`)

Optional, each a path under `assets/` to a `.ogg` or `.wav`: `passBy` (a car going past; it is pitch-bent as it passes), `ambience`
(the garage, looped), `radioOpen`, `radioClose` and `gun` (one wheel gun; four are played). Anything you leave out is the game's
synthesised sound. A file the browser cannot decode falls back to the synthesised sound with a console warning.

## A worked example

This pack paints one team in two colours with a stripe, gives one driver a number and a curly-haired archetype, and replaces the radio
beep. Save it as `mods/local/example/manifest.json` and put a short WAV at `mods/local/example/assets/beep.wav`.

```json
{
  "schema": 1,
  "id": "example",
  "name": "Example",
  "version": "1.0.0",
  "author": "me",
  "licence": "CC0-1.0",
  "kind": "mod",
  "teams": {
    "VMR": {
      "displayName": "Example Racing",
      "short": "EXR",
      "colours": { "primary": "#1b9aaa", "secondary": "#f7f7f7", "accent": "#ef476f" },
      "livery": { "pattern": "stripe" },
      "crew": { "kit": "#1b9aaa", "helmet": "#f7f7f7" },
      "engineers": ["e-curly", "strat"]
    }
  },
  "drivers": {
    "ALD": {
      "displayName": "A. Driver",
      "number": 7,
      "archetype": "d-curly",
      "helmet": { "primary": "#ef476f", "secondary": "#f7f7f7", "pattern": "hoops" }
    }
  },
  "archetypes": {
    "e-curly": { "role": "engineer", "build": "medium", "height": 1.0, "hair": "curly", "skin": "#8d5a3c" },
    "strat": { "role": "strategist", "build": "lean", "height": 0.98, "hair": "tied", "skin": "#e0b48f" },
    "d-curly": { "role": "driver", "build": "lean", "height": 0.94, "hair": "curly", "skin": "#7a4e35" }
  },
  "sounds": { "radioOpen": "assets/beep.wav" }
}
```

Check it, then choose it in **Packs**:

```
npm run mods:validate -- mods/local/example
OK   example@1.0.0 (mod, 2 files, 1.2 KB)  .../mods/local/example
1 of 1 packs are valid.
```

For a complete pack with every team and driver, a livery image and two sounds, read `mods/examples/neon-harbour/manifest.json`.

## When something is wrong

Every problem is listed at once, as `pack:path: message`, in `npm run mods:validate`, in **Packs** (under the pack, in red) and in the
list the dev server serves. A pack with any error is not loaded and cannot be chosen; the game keeps using the pack it had.

```
my-pack:assets/payload.js: file type '.js' is not allowed (allowed: png, webp, svg, ogg, wav, and manifest.json)
my-pack:manifest.json.version: has the wrong format: expected a version like 1.0.0
my-pack:manifest.json.teams.VMR: must NOT have additional properties (unknown key 'sponsor': remove it or check the spelling)
my-pack:manifest.json.teams.VMR.colours.primary: has the wrong format: expected a colour like #1a2b3c
my-pack:manifest.json:sounds.gun: refers to 'assets/missing.wav', which is not in the pack (or failed a check above)
my-pack:assets/link.png: symbolic links are not allowed
```

If the manifest cannot be read as a whole (bad JSON, a schema error), the messages are prefixed with the folder name; once it parses, with
its `id`.

## What a mod cannot do

Run code, read files outside its folder, change the race, the engine, the parameter bundle or the scoring, add new kinds of file, or
see anything the game does not show you: the scene reads the same visible state a player gets, and a test checks that no hidden
field can reach it.
