import { LABELS, MODULE_ID, OPTION, STATES } from "../constants.js";
import { effectValue } from "../effect-choices.js";
import { featureHooks } from "../feature-hooks.js";
import { animationModulesActive, sequencerReady } from "../sequencer.js";
import { getState } from "../state.js";
import { systemFlags } from "../system.js";

/**
 * Attack animations. Solarian strikes are synthetic weapons (from Strike rule elements), so
 * Automated Animations can't attach to them. Instead we watch attack-roll chat cards.
 *
 * Which animation plays comes through effectValue (scripts/effect-choices.js). An attack
 * follows whoever rolled it, as dice do: the world settings, or the roller's own choices when
 * players may make their own, whoever owns the token.
 */

const ATTACKS = {
  "solar-weapon": {
    label: "Solar Weapon",
    graviton: "jb2a.energy_strands.range.multiple.dark_purple.01",
    photon: "jb2a.scorching_ray.02.orange",
  },
  "solar-flare": {
    label: "Solar Flare",
    graviton: "jb2a.fireball.beam.dark_purple",
    photon: "jb2a.fireball.beam.orange",
  },
};

const hooks = featureHooks("attacks");

function attackFromMessage(message) {
  const ctx = systemFlags(message)?.context;
  if (ctx?.type !== "attack-roll") return null;
  const opts = new Set(ctx.options ?? []);
  // By slug first. A strike that is one of these under another slug carries its tag
  // (Twin Weapons: slug "twin-solar-weapon", tag "solar-weapon").
  const slug = Object.keys(ATTACKS).find((k) => opts.has(`item:slug:${k}`))
    ?? Object.keys(ATTACKS).find((k) => opts.has(`item:tag:${k}`));
  if (!slug) return null;
  // Attunement as of the roll; fall back to the live state.
  const state = STATES.find((s) => opts.has(`${OPTION}:${s}`)) ?? getState(message.actor);
  return { slug, state, ctx };
}

function sourceTokenFor(message) {
  const id = message.speaker?.token;
  return (id && canvas.tokens.get(id)) || message.actor?.getActiveTokens?.(true)[0] || null;
}

function targetTokenFor(message, ctx) {
  const uuid = ctx.target?.token;
  const doc = uuid ? fromUuidSync(uuid) : null;
  if (doc?.parent === canvas.scene && doc.object) return doc.object;
  return message.author?.targets?.first() ?? null;
}

export async function playAttack(message) {
  if (!game.settings.get(MODULE_ID, "attacks") || typeof Sequencer === "undefined") return;
  const hit = attackFromMessage(message);
  if (!hit || hit.state === "unattuned") return;
  const exists = (value) => Sequencer.Database.entryExists(value);
  const path = String(effectValue(`attack.${hit.slug}.${hit.state}`, message.author, exists) ?? "").trim();
  if (!path) return;
  if (!Sequencer.Database.entryExists(path)) return console.warn(`${MODULE_ID} | JB2A entry not found: ${path}`);

  const source = sourceTokenFor(message);
  const target = targetTokenFor(message, hit.ctx);
  if (!source || !target || source === target) return;

  const missed = ["failure", "criticalFailure"].includes(hit.ctx.outcome);
  await new Sequence({ moduleName: MODULE_ID })
    .effect()
      .file(path)
      .atLocation(source)
      .stretchTo(target)
      .missed(missed)
    .play();
}

/** One Sequencer path per attack and attunement, after the on/off switch. One menu box per attack. */
const groups = {};
const settings = {
  attacks: {
    name: "JB2A attack animations",
    hint: "Play a ranged animation from the Solarian to the target when Solar Weapon or Solar Flare is rolled while attuned. Misses animate as misses. On by default when Sequencer and JB2A are active.",
    scope: "world", type: Boolean, default: animationModulesActive,
  },
};
for (const [slug, cfg] of Object.entries(ATTACKS)) {
  groups[slug] = { label: cfg.label, keys: [] };
  for (const state of ["graviton", "photon"]) {
    groups[slug].keys.push(`attack.${slug}.${state}`);
    settings[`attack.${slug}.${state}`] = {
      name: `${cfg.label} - ${LABELS[state]}`,
      label: LABELS[state],
      hint: "Sequencer database path for a ranged effect. Blank: no animation.",
      picker: "ranged",
      player: true, scope: "world", type: String, default: cfg[state],
    };
  }
}

export const attacks = {
  id: "attacks",
  label: "Attack animations",
  hint: "Needs Sequencer and JB2A. Solar Weapon and Solar Flare attack rolls play a ranged animation from the Solarian to the target.",
  requires: "animations",
  groups,
  settings,
  init() {
    hooks.clear();

    // Only the rolling client plays (Sequencer broadcasts to everyone).
    hooks.on("createChatMessage", (message) => {
      if (!sequencerReady() || message.author?.id !== game.user.id || !attackFromMessage(message)) return;
      // Let Dice So Nice finish its 3D roll so the animation lands with the result.
      const dice = game.modules.get("dice-so-nice")?.active && game.dice3d
        ? game.dice3d.waitFor3DAnimationByMessageID(message.id).catch(() => {})
        : Promise.resolve();
      dice.then(() => playAttack(message)).catch((err) => console.warn(`${MODULE_ID} | Attack animation failed`, err));
    });
  },
};
