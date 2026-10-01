# Outrider's Stellar Attunement

<div align="center">

[![Part of Outrider's Pathfinder Tools](https://img.shields.io/badge/Part%20of-Outrider%27s%20Pathfinder%20Tools-7000d6?style=for-the-badge)](https://github.com/0utrider/pathfinder)

</div>

SF2e Solarian helper. Cycles Stellar Attunement and keeps token art in sync.

## Cycle

| Current | Click → |
|---|---|
| Unattuned | Graviton |
| Graviton / Photon (1st click) | the opposite attunement |
| Graviton / Photon (2nd click) | Unattuned |

Changing attunement from the character sheet (Actions › Encounter) or PF2e HUD also swaps the art, and resets the swap tracking.

## Art convention

Default art (unattuned) = the prototype token image. Graviton = `<base>-1.<ext>`, Photon = `<base>-2.<ext>`.
e.g. `actors/David/Jaxon-token.webp` → `Jaxon-token-1.webp` / `Jaxon-token-2.webp`.
Override per actor: right-click the Token HUD button, or `api.configure(actor)`.

## Macro

```js
game.modules.get("outrider-stellar-attunement").api.cycle();          // controlled token / assigned character
game.modules.get("outrider-stellar-attunement").api.cycle("Jaxon \"Jax\"");
game.modules.get("outrider-stellar-attunement").api.setAttunement(null, "photon");
```

## Macros

On install and on every update, the module copies its macros from the compendium into the world, in the **Macros** sidebar under **Outrider's Mods > Stellar Attunement**. They default to Observer, so players can see and run them without a GM having to share them by hand. The compendium itself, **Stellar Attunement Macros** (`outrider-stellar-attunement.outrider-stellar-attunement-macros`), lives directly in the brand-violet **Outrider's Mods** compendium folder, alongside the rest of the Outrider family's packs.

| Macro | Does |
|---|---|
| Graviton Attunement | Set Graviton |
| Photon Attunement | Set Photon |
| Unattuned | Set Unattuned |
| Cycle Attunement | Run the cycle above |

Each acts on the controlled token, or your assigned character. If a GM changes a macro's ownership or moves it, that choice is kept on later syncs. Pack source lives in `src/packs/`, and `packs/` is built with `@foundryvtt/foundryvtt-cli` `compilePack`.

## JB2A token borders

With Sequencer + JB2A active, a persistent border marks the attunement:

- Graviton → `jb2a.token_border.circle.static.purple.006`
- Photon → `jb2a.token_border.circle.static.orange.008`
- Unattuned → border removed

Borders draw behind the token by default and are scaled so the JB2A dark ring just peeks out from behind the token frame. Changing any border setting replays the borders live.

Switching removes this module's border first. It also removes any other JB2A token border, e.g. one from Automated Animations; you can turn that off in settings. Borders are Sequencer persistent effects on each token. When a scene loads or a token is placed, the active GM's client (or the owning player's, if no GM is online) re-checks the borders.

### During the token's turn

Foundry v13+ draws the combat turn marker on the interface layer, above all token art, so it covers a behind-the-token border. The **Border during the token's turn** setting chooses what to do while it's that token's turn:

- **Expand** (default): grow the border to wrap just outside the turn marker (scale × the marker's size ratio, 1.5 by default), then shrink it back when the turn passes.
- **Above**: draw the border over the marker. This also draws it over the portrait.
- **Off**: leave it as is.

## Combat end

When the GM ends an encounter, every attuned Solarian in it drops to Unattuned (art and border included). Turn this off with **Unattune when the encounter ends**.

## Attack animations

Solarian strikes are synthetic weapons, so Automated Animations can't attach to them. Instead, when an attack-roll card for **Solar Weapon** or **Solar Flare** is posted, the rolling client plays a ranged Sequencer effect from the Solarian to the target. The attunement comes from the roll's own options, so the animation reflects the attunement at the moment of the roll. Misses animate as misses. Unattuned rolls play nothing.

| Attack | Graviton | Photon |
|---|---|---|
| Solar Weapon | `jb2a.energy_strands.range.multiple.dark_purple.01` | `jb2a.scorching_ray.02.orange` |
| Solar Flare | `jb2a.fireball.beam.dark_purple` | `jb2a.fireball.beam.orange` |

These match the Automated Animations menu picks (AA "Energy Strand 02" is JB2A's `multiple` strand). The target is the one recorded on the roll, falling back to the roller's current target.

## Settings

- **Update tokens in all scenes** (world, default on)
- **Token HUD button** (client, default on)
- **Show notification** (client, default off)
- **JB2A token borders** (world, default on)
- **Graviton / Photon border** - Sequencer DB paths (world)
- **Draw borders behind the token** (world, default on)
- **Graviton / Photon border scale** - `scaleToObject`, default 2.05 each (world)
- **Border during the token's turn** - expand / above / off (world, default expand)
- **Unattune when the encounter ends** (world, default on)
- **Clear other JB2A token borders** (world, default on)
- **JB2A attack animations** (world, default on)
- **Solar Weapon / Solar Flare × Graviton / Photon** - Sequencer DB paths (world)
