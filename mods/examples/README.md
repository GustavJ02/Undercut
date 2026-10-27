# Neon Harbour (example mod)

A complete, fictional content pack used as the worked example in `docs/modding.md` and as the alternate pack in the tests. Every
name, colour, person and sound here is invented for this project and released under CC0-1.0; none of it is modelled on a real
team, driver or livery.

- `neon-harbour/manifest.json`: all teams and drivers of the bundle, ten archetypes, two sound overrides.
- `neon-harbour/assets/harbour-livery.png`: a livery overlay for one team (generated, 128x32).
- `neon-harbour/assets/radio-open.wav`, `gun.wav`: short synthesised sounds (8 kHz mono).

Validate it with `npm run mods:validate -- mods/examples/neon-harbour` from `client/`.
