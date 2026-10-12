# Outrider's Stellar Attunement

<div align="center">

[![Part of Outrider's Pathfinder Tools](https://img.shields.io/badge/Part%20of-Outrider%27s%20Pathfinder%20Tools-7000d6?style=for-the-badge)](https://github.com/0utrider/pathfinder)
[![Available on Foundry Package Browser](https://img.shields.io/badge/Foundry-Package%20Page-7000d6?style=for-the-badge)](https://foundryvtt.com/packages/outrider-stellar-attunement)

</div>

SF2e Solarian helper. Cycles Stellar Attunement and keeps token art in sync.

<p align="center"><img src="docs/demo-jb2a.webp" alt="A Solarian token cycling through Stellar Attunement, with the module's JB2A token border and attack animation playing" width="480"></p>

## Cycle

| Current | Click → |
|---|---|
| Unattuned | Graviton |
| Graviton / Photon (1st click) | the opposite attunement |
| Graviton / Photon (2nd click) | Unattuned |

Changing attunement from the character sheet (Actions › Encounter) or PF2e HUD also swaps the art, and resets the swap tracking.

## Actions that change attunement

With **Follow cycle and disharmony actions** on (the default), the module reads a Solarian's action cards in chat (the action icon or the **Use** button on the sheet) and changes the attunement the way the rules say:

- **cycle** (Stellar Rush, Eclipse Strike, Wormhole, ...): Graviton and Photon swap. Used while Unattuned, nothing changes.
- **disharmony** (Shattering Impact, Big Bang, ...): Unattuned.
- **Attune**: a small window asks Graviton or Photon. Closing it changes nothing.
- An **attuned** action used while Unattuned gives a warning and changes nothing.

The rules change the state once the action is complete. Eclipse Strike, Hampering Flare, Clinging Flare, Shattering Impact, Flicker Strike, Solar Barrage and Unstable Flare include Strikes, so post the action's card first and then roll its Strikes: the state changes after them (Solar Barrage after three, Flicker Strike after two or after a first Strike that misses), when the turn moves on, or after two minutes. The Strikes roll, and animate, in the attunement the action started in. Changing the attunement by hand in the meantime cancels the change.

Rolls made from the card (damage, saves) do not count. Posting the same card again to show it to the table counts as using it again. The change is made by the client of the user who posted the card, so it happens once however many users are connected.

## Art convention

Default art (unattuned) = the prototype token image. Graviton = `<base>-1.<ext>`, Photon = `<base>-2.<ext>`.
e.g. `tokens/solarian.webp` → `solarian-1.webp` / `solarian-2.webp`.
Override per actor: right-click the Token HUD button, or `api.configure(actor)`. A field left blank uses the default for that state, and blanking a field you had filled removes that override.

The module writes each state's art to the prototype token, so new tokens come out right. It keeps a note of the original image on the actor, so Unattuned goes back to it even when only the attuned states have overrides. If you change the prototype token image yourself, that becomes the new original.

A world that used overrides on 1.0.x may already have lost the original (1.0.x kept no note). Set the prototype token image once, or fill in the Unattuned override, and it is remembered from then on.

## Macro

```js
game.modules.get("outrider-stellar-attunement").api.cycle();          // controlled token / assigned character
game.modules.get("outrider-stellar-attunement").api.cycle("Actor Name");                // by name, id or uuid
game.modules.get("outrider-stellar-attunement").api.setAttunement(null, "photon");
```

## Macros

On install and on every update, the module copies its macros from the compendium into the world, in the **Macros** sidebar under **Outrider's Mods > Stellar Attunement**. They default to Observer, so players can see and run them without a GM having to share them by hand. The compendium itself, **Macros** (`outrider-stellar-attunement.outrider-stellar-attunement-macros`), lives directly in the brand-violet **Outrider's Mods** compendium folder, alongside the rest of the Outrider family's packs.

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

Those two are in the Patreon JB2A pack. The free pack has blue borders only, so with the free pack alone the defaults are its dark ring for Graviton (`jb2a.token_border.circle.static.blue.006`) and its bright ring for Photon (`jb2a.token_border.circle.static.blue.007`).

Borders draw behind the token by default and are scaled so the JB2A dark ring just peeks out from behind the token frame. Changing any border setting replays the borders live.

Switching removes this module's border first. It also removes any other JB2A token border, e.g. one from Automated Animations; you can turn that off in settings. Borders are Sequencer persistent effects on each token. When a scene loads or a token is placed, the active GM's client (or the owning player's, if no GM is online) re-checks the borders, once Sequencer has put its own persistent effects back.

### During the token's turn

Foundry v13+ draws the combat turn marker on the interface layer, above all token art, so it covers a behind-the-token border. The **Border during the token's turn** setting chooses what to do while it's that token's turn:

- **Above** (default): draw the border over the marker. This also draws it over the portrait.
- **Expand**: grow the border to wrap just outside the turn marker (scale × the marker's size ratio, 1.5 by default), then shrink it back when the turn passes.
- **Off**: leave it as is.

The default was Expand up to 1.1.0. A world that never changed this setting now gets Above; pick Expand to keep the old behavior.

## Dynamic Token Ring

On by default in a world without Sequencer and JB2A, off by default in a world that has both active, where the token border already marks the attunement. Either way it is a setting, and a value you saved is kept. With **Color the token ring** on, a token that has Foundry's Dynamic Token Ring enabled takes a ring color and a background color for its attunement:

- Graviton → ring `#8a5cff`
- Photon → ring `#ff9d00`
- Unattuned → the colors of the actor's prototype token

The background colors are blank by default, which keeps the token's own background. The colors travel in the same token update as the art swap, and follow **Update tokens in all scenes**. A token placed while its actor is attuned starts with the state's colors.

Only a ring that is already on is colored: the module does not turn rings on by itself, because that changes how the token art is framed. When the attunement changes to Graviton or Photon and a token of that Solarian on the scene has its ring off, the user who made the change is asked once per token per session: **Turn on for this token**, **This token and new ones** (the prototype token too), **Not now**, or **Do not ask for** that actor (stored on the actor). The prototype token's ring colors are never written, so turning the option off puts every token back to them. Ring, art swap and JB2A border work together on one token.

If the ring has its own subject texture (Appearance tab, Ring Subject), Foundry draws that image and the art swap does not show on that token.

**Flash the ring on a change** (off by default) flashes the ring in its new color when the module changes it, for everyone viewing the scene.

## Combat end

When the GM ends an encounter, every attuned Solarian in it drops to Unattuned (art and border included). Turn this off with **Unattune when the encounter ends**.

## Attack animations

Solarian strikes are synthetic weapons, so Automated Animations can't attach to them. Instead, when an attack-roll card for **Solar Weapon** or **Solar Flare** is posted, the rolling client plays a ranged Sequencer effect from the Solarian to the target. The attunement comes from the roll's own options, so the animation reflects the attunement at the moment of the roll. Misses animate as misses. Twin Weapons strikes use the Solar Weapon animations.

| Attack | Graviton | Photon |
|---|---|---|
| Solar Weapon | `jb2a.energy_strands.range.multiple.dark_purple.01` | `jb2a.scorching_ray.02.orange` |
| Solar Flare | `jb2a.fireball.beam.dark_purple` | `jb2a.fireball.beam.orange` |

With the free JB2A pack alone, three of these are not in its database and the defaults are the nearest entries it has:

| Attack | Graviton | Photon |
|---|---|---|
| Solar Weapon | `jb2a.energy_strands.range.multiple.purple.01` | `jb2a.scorching_ray.01.orange` |
| Solar Flare | `jb2a.eldritch_blast.purple` | `jb2a.fireball.beam.orange` |

The Patreon defaults match the Automated Animations menu picks (AA "Energy Strand 02" is JB2A's `multiple` strand). The target is the one recorded on the roll, falling back to the roller's current target.

## Player choices

Off by default. With **Allow Players to Customize Effects** on, each player can pick their own effects in the same settings window, in a **Your effects** box below their two per-browser settings, and everyone sees them:

- the border animation and its scale, for Graviton and for Photon
- the ring color and background color, for Graviton and for Photon
- the Solar Weapon and Solar Flare attack animations, for Graviton and for Photon

The GM's settings stay the default. A field a player leaves blank uses the GM's setting, which the field shows in grey. The crossed-circle button beside a field sets it to **none** for that player: no border, no attack animation, or the token's own ring color, whatever the GM set. The on and off switches, the border layer, the turn marker behavior and the rest stay with the GM.

Whose choice applies:

- A border or a ring sits on a token, so it follows the token's player: the player who has that actor as their assigned character, else the only player who owns it. An actor only the GM owns, or one several players own with none of them assigned, uses the GM's settings.
- An attack animation follows whoever rolled the attack, as dice do, whoever owns the token.

The choices are stored on the player's own User document, the way Dice So Nice stores its appearance settings. When a player saves, the active GM's client redraws that player's borders and rings (the player's own client, if no GM is online). Turning the switch off puts the GM's effects back at once; what players saved is kept and ignored until the switch is on again.

The GM's **Player choices** box names the players who have choices saved. **Clear all** removes them for good, after a confirmation. It acts at once and does not wait for **Save Changes**, because it changes the players' User documents and not this window's settings.

## Settings

The module has one entry in **Configure Settings**: the **Configure Settings** button under its name opens a single window, one box per area. World settings are for the GM. The two marked with a person icon are saved per browser. A player sees those two, and the **Your effects** box when the GM allows player choices.

Each field has a reset button at its right end, which puts the field back to its default (for a player's own choice: back to blank, the GM's setting). **Reset Defaults**, beside **Save Changes**, does that for every field in the window. A field changed since the window opened is marked. Nothing is stored until you save, so closing the window undoes a reset.

Without Sequencer and JB2A both active, the **Token borders** and **Attack animations** boxes are left out, and a note at the top of the window says so and links to what is missing. [JB2A has a free version](https://foundryvtt.com/packages/JB2A_DnD5e).

The default border and attack paths depend on which JB2A pack is active: the Patreon pack's entries when it is active, the free pack's when only the free pack is. A default is not a stored value, so a world that moves from one pack to the other gets the other defaults on its next load, and a path you saved yourself stays as you saved it.

**Attunement**

- **Update tokens in all scenes** (world, default on)
- **Token HUD button** (per browser, default on)
- **Show notification** (per browser, default off)

**Actions**

- **Follow cycle and disharmony actions** (world, default on)

**Token borders**

- **JB2A token borders** (world, default on when Sequencer and JB2A are active)
- **Draw borders behind the token** (world, default on)
- **Border during the token's turn** - above / expand / off (world, default above)
- **Clear other JB2A token borders** (world, default on)
- **Graviton** and **Photon**: **Border** (Sequencer database path, default by JB2A pack) and **Scale** (`scaleToObject`, default 2.05)

**Dynamic Token Ring**

- **Color the token ring** (world, default on, or off when Sequencer and JB2A are active)
- **Flash the ring on a change** (world, default off)
- **Graviton** and **Photon**: **Ring color** and **Background color**

**Attack animations**

- **JB2A attack animations** (world, default on when Sequencer and JB2A are active)
- **Solar Weapon** and **Solar Flare**: one Sequencer database path each for Graviton and Photon (default by JB2A pack)

**Player choices**

- **Allow Players to Customize Effects** (world, default off)

**Encounter end**

- **Unattune when the encounter ends** (world, default on)

Setting keys are the same as in 1.0.x, so a world keeps its values. Two defaults changed in 1.1.0 (the turn marker behavior and the ring option, above): a world that never saved those two settings follows the new defaults. 1.1.1 adds **Follow cycle and disharmony actions**, on by default, so a world that updates starts following action cards.

### Picking an animation

With Sequencer and JB2A active, each border and attack field has two buttons beside it. Without them the fields are plain text.

- **Browse** opens a picker: one drop-down per part of the database path, a looping clip of the entry, and the path itself. Changing one part keeps the parts after it where the new path has them, so a border's color can change without losing its design number. Border fields list token borders, attack fields list ranged entries (the ones Sequencer can stretch to a target), with the energy and beam groups first. **Show the whole database** lifts the filter. **Use this animation** puts the path in the field. Nothing is stored until you save the settings window.
- **Play** shows the animation on the canvas, for you alone and without storing anything: a border on your selected token (else the first Solarian on the scene) at the scale and layer in the form, an attack from that token to your target, or six squares to the right with no target.

## Install

Paste this manifest URL into **Add-on Modules > Install Module**:

```
https://github.com/0utrider/outrider-stellar-attunement/releases/latest/download/module.json
```
