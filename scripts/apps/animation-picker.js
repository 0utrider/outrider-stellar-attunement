import { MODULE_ID } from "../constants.js";
import { animationsInstalled, sequencerReady } from "../sequencer.js";
import { getState } from "../state.js";

const { ApplicationV2 } = foundry.applications.api;

/**
 * Picking a Sequencer database entry for a border or an attack animation, and seeing it
 * before it is saved.
 *
 * The window is a row of drop-downs, one per segment of the database path
 * ("jb2a.token_border.circle." then static, purple, 006), over a looping clip of the entry
 * chosen. "Play on token" plays it once on the canvas for this user alone, at the scale and
 * layer the settings form has at that moment. "Use this animation" hands the path back to
 * the form; nothing is stored until the form is saved.
 *
 * Built on Sequencer.Database alone (publicFlattenedEntries, getEntry, entryExists), so it
 * needs Sequencer and a module that registers entries with it (JB2A), and nothing else.
 */

const PREVIEW_NAME = `${MODULE_ID}.preview`;

/**
 * What each kind of field lists. `test` picks the entries that fit, `first` names the groups
 * (the path segment after the module's) that go to the top of the first drop-down.
 */
const KINDS = {
  border: {
    title: "Token border",
    test: (path) => /(^|\.)token_border(\.|$)/.test(path),
    first: [],
  },
  ranged: {
    title: "Ranged animation",
    test: (path, entry) => isRanged(entry),
    first: ["energy_strands", "energy_beam", "scorching_ray", "fireball", "lasershot", "ranged"],
  },
};

/** True when the picker can be offered: Sequencer and JB2A active, and the database loaded. */
export function pickerAvailable() {
  return animationsInstalled() && sequencerReady() && entryPaths().length > 0;
}

function entryPaths() {
  try {
    return Sequencer.Database.publicFlattenedEntries ?? [];
  } catch {
    return [];
  }
}

function entryFor(path) {
  try {
    const entry = Sequencer.Database.getEntry(path, { softFail: true });
    return Array.isArray(entry) ? entry[0] : entry;
  } catch {
    return null;
  }
}

/** A ranged entry has one file per distance ("05ft", "30ft", ...), which is what stretchTo picks from. */
function isRanged(entry) {
  const file = entry?.file;
  if (entry?.rangeFind === true) return true;
  return !!file && typeof file === "object" && !Array.isArray(file) && Object.keys(file).some((key) => /^\d+ft$/.test(key));
}

/** One file to show for an entry: the middle distance of a ranged one, the first of several variants. */
function clipFor(path) {
  let file = entryFor(path)?.file;
  if (file && typeof file === "object" && !Array.isArray(file)) file = file["30ft"] ?? file["15ft"] ?? Object.values(file)[0];
  if (Array.isArray(file)) file = file[0];
  return typeof file === "string" ? file : null;
}

/**
 * The database lists a ranged entry once per distance, and once more per variant of each
 * ("jb2a.fireball.beam.orange.05ft", "jb2a.scorching_ray.02.orange.30ft.1", ...). The path to
 * store is the one above them: Sequencer picks the distance and the variant itself.
 */
const DISTANCE = /\.\d+ft(\.\d+)?$/;
const storedPath = (path, entry) => (isRanged(entry) ? entry.dbPath ?? path.replace(DISTANCE, "") : path);

/** The entries of one kind (any other name: every entry), sorted. Kept until the database changes size. */
const cache = new Map();
function pathsFor(kind) {
  const all = entryPaths();
  const key = `${kind}:${all.length}`;
  if (!cache.has(key)) {
    const test = KINDS[kind]?.test;
    const unique = new Set();
    for (const path of all) {
      const entry = entryFor(path);
      if (!test || test(path, entry)) unique.add(storedPath(path, entry));
    }
    cache.set(key, [...unique].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
  }
  return cache.get(key);
}

/** Where a preview plays: the controlled token, else the first Solarian on the scene, else nothing. */
function previewToken() {
  return canvas.tokens?.controlled[0] ?? canvas.tokens?.placeables.find((token) => getState(token.actor)) ?? null;
}

/**
 * Plays a database entry once on the canvas, for this user only and with nothing stored.
 * A border goes on the token for a few seconds at `scale`, behind it when `below`. A ranged
 * entry goes from the token to this user's target, or six squares to the right with no
 * target. With no token on the scene both play around the middle of the view.
 */
export async function playPreview(kind, path, { scale = 2.05, below = true } = {}) {
  if (!animationsInstalled() || !canvas.ready) return;
  if (!path || !Sequencer.Database.entryExists(path)) {
    ui.notifications.warn(path ? `No Sequencer database entry "${path}".` : "No animation to play: the field is blank.");
    return;
  }
  await Sequencer.EffectManager.endEffects({ name: PREVIEW_NAME });
  const token = previewToken();
  const middle = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
  const grid = canvas.grid.size;
  const effect = new Sequence({ moduleName: MODULE_ID }).effect().name(PREVIEW_NAME).file(path).locally();
  if (kind === "ranged") {
    const from = token ?? { x: middle.x - grid * 3, y: middle.y };
    const start = token?.center ?? from;
    const target = [...game.user.targets].find((t) => t !== token);
    effect.atLocation(from).stretchTo(target ?? { x: start.x + grid * 6, y: start.y });
  } else if (token) {
    effect.attachTo(token, { bindAlpha: false }).scaleToObject(scale).belowTokens(below).duration(4000).fadeIn(300).fadeOut(300);
  } else {
    effect.atLocation(middle).size(grid * scale).duration(4000).fadeIn(300).fadeOut(300);
  }
  await effect.play();
}

export class AnimationPicker extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-animation-picker`,
    tag: "form",
    classes: ["osa-picker"],
    window: { icon: "fa-solid fa-film", contentClasses: ["standard-form"] },
    position: { width: 520 },
    form: { handler: AnimationPicker.#onSubmit, closeOnSubmit: true },
    actions: { play: AnimationPicker.#onPlay },
  };

  /**
   * @param {object} options
   * @param {"border"|"ranged"} options.kind   Which entries to list.
   * @param {string} [options.current]         The path in the field now; the picker opens on it.
   * @param {string} [options.label]           The setting's name, for the window title.
   * @param {Function} [options.onPick]        Called with the chosen path.
   * @param {Function} [options.previewOptions] Returns { scale, below } for "Play on token".
   */
  constructor({ kind, current, label, onPick, previewOptions, ...options } = {}) {
    super(options);
    this.kind = kind in KINDS ? kind : "border";
    this.onPick = onPick;
    this.previewOptions = previewOptions;
    this.label = label;
    // A path from outside the kind's list (typed by hand, or another module's) opens on the whole database.
    this.all = !!current && !pathsFor(this.kind).includes(current) && pathsFor("all").includes(current);
    this.segments = current && this.#paths().includes(current) ? current.split(".") : [];
  }

  get title() {
    return this.label ? `${KINDS[this.kind].title}: ${this.label}` : KINDS[this.kind].title;
  }

  #paths() {
    return this.all ? pathsFor("all") : pathsFor(this.kind);
  }

  /**
   * The drop-downs for the current choice. Each level lists what continues the path so far;
   * a level with a single option is part of the fixed prefix and is shown as text. Where the
   * choice stops short of an entry, the first option of each further level fills it in.
   */
  #levels() {
    const paths = this.#paths().map((path) => path.split("."));
    const first = this.all ? [] : KINDS[this.kind].first;
    const levels = [];
    const chosen = [];
    let rest = paths;
    for (let depth = 0; rest.length && rest.some((p) => p.length > depth); depth++) {
      let options = [...new Set(rest.filter((p) => p.length > depth).map((p) => p[depth]))];
      const top = first.filter((name) => options.includes(name));
      if (top.length) options = [...top, ...options.filter((name) => !top.includes(name))];
      const value = options.includes(this.segments[depth]) ? this.segments[depth] : options[0];
      chosen.push(value);
      levels.push({ depth, options, value, top: top.length });
      rest = rest.filter((p) => p[depth] === value);
      if (rest.length === 1 && rest[0].length === depth + 1) break;
    }
    this.segments = chosen;
    return levels;
  }

  get path() {
    return this.segments.join(".");
  }

  async _prepareContext() {
    const levels = this.#levels();
    return { levels, path: this.path, count: this.#paths().length, clip: clipFor(this.path) };
  }

  async _renderHTML({ levels, path, count, clip }) {
    const row = document.createElement("div");
    row.className = "osa-picker-path";
    for (const level of levels) {
      if (level.options.length === 1) {
        const fixed = document.createElement("span");
        fixed.textContent = `${level.value}.`;
        row.append(fixed);
        continue;
      }
      const select = document.createElement("select");
      select.dataset.depth = level.depth;
      select.ariaLabel = `Path segment ${level.depth + 1}`;
      level.options.forEach((name, index) => {
        if (level.top && index === level.top) {
          const gap = document.createElement("option");
          gap.disabled = true;
          gap.textContent = "----------";
          select.append(gap);
        }
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        option.selected = name === level.value;
        select.append(option);
      });
      select.addEventListener("change", () => {
        // Later segments stay as they were where the new path still has them (a color, a variant
        // number); #levels falls back to the first option only where one no longer exists.
        this.segments = this.segments.map((value, depth) => (depth === level.depth ? select.value : value));
        this.render();
      });
      row.append(select);
    }

    const stage = document.createElement("div");
    stage.className = "osa-picker-stage";
    if (clip && /\.(webm|mp4|m4v|ogv)$/i.test(clip)) {
      const video = document.createElement("video");
      Object.assign(video, { src: clip, autoplay: true, loop: true, muted: true, playsInline: true });
      stage.append(video);
    } else if (clip) {
      const image = document.createElement("img");
      image.src = clip;
      image.alt = "";
      stage.append(image);
    } else {
      stage.textContent = "No preview for this entry.";
    }

    const chosen = document.createElement("p");
    chosen.className = "osa-picker-chosen";
    const code = document.createElement("code");
    code.textContent = path;
    chosen.append(code);

    const all = document.createElement("label");
    all.className = "osa-picker-all";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.all;
    box.addEventListener("change", () => {
      this.all = box.checked;
      if (!this.#paths().includes(this.path)) this.segments = [];
      this.render();
    });
    all.append(box, ` Show the whole database (${count} ${count === 1 ? "entry" : "entries"} listed)`);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = this.kind === "ranged"
      ? "Play on token: from your selected token (else the first Solarian on the scene) to your target, or six squares to the right. Only you see it."
      : "Play on token: on your selected token, else the first Solarian on the scene, at the scale in the settings form. Only you see it.";

    const footer = document.createElement("footer");
    footer.className = "form-footer";
    const play = document.createElement("button");
    play.type = "button";
    play.dataset.action = "play";
    const playIcon = document.createElement("i");
    playIcon.className = "fa-solid fa-play";
    play.append(playIcon, " Play on token");
    const use = document.createElement("button");
    use.type = "submit";
    const useIcon = document.createElement("i");
    useIcon.className = "fa-solid fa-check";
    use.append(useIcon, " Use this animation");
    footer.append(play, use);

    return [row, stage, chosen, all, hint, footer];
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result);
  }

  static #onPlay() {
    return playPreview(this.all && !isRanged(entryFor(this.path)) ? "border" : this.kind, this.path, this.previewOptions?.() ?? {});
  }

  static #onSubmit() {
    this.onPick?.(this.path);
  }

  async _onClose(options) {
    await super._onClose?.(options);
    if (typeof Sequencer !== "undefined") await Sequencer.EffectManager.endEffects({ name: PREVIEW_NAME }).catch(() => {});
  }
}
