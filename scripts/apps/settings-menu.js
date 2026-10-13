import { MODULE_ID } from "../constants.js";
import { CHOICES_FLAG, NONE, choiceKey, clearChoices, playerEffectsOn, playersWithChoices, storedChoice } from "../effect-choices.js";
import { activeFeatures } from "../features/index.js";
import { featureSettings } from "../feature-settings.js";
import { animationModulesActive, jb2aActive, sequencerActive } from "../sequencer.js";
import { AnimationPicker, pickerAvailable, playPreview } from "./animation-picker.js";

const { ApplicationV2 } = foundry.applications.api;
const { HTMLColorPickerElement, HTMLRangePickerElement } = foundry.applications.elements;

/** Form field name prefix of a player's own choice: "player:border.graviton". */
const PLAYER = "player:";

/** Where to get the modules the animation features need. */
const PACKAGES = {
  Sequencer: { label: "Get Sequencer", url: "https://foundryvtt.com/packages/sequencer" },
  JB2A: { label: "Get the free JB2A module", url: "https://foundryvtt.com/packages/JB2A_DnD5e" },
};

/** A field's value as the form holds it. */
const read = (el) => (el.type === "checkbox" ? el.checked : el.value);

/** Two field values that mean the same: 2.05 and "2.05", null and "", "#FF9D00" and "#ff9d00". */
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * The one entry this module shows in Foundry's module settings list.
 *
 * One fieldset per feature that declares settings, in registry order, headed by the feature's
 * `label` and `hint`, with one fainter box inside it for each group the feature declares
 * (features/index.js describes the shape). The control comes from the declaration:
 *
 * - `choices`: a drop-down
 * - Boolean: a checkbox
 * - Number with `range`: a slider
 * - String with `color`: a color picker
 * - String with `picker`: a text field for a Sequencer database path, with a browse button
 *   and a play button when Sequencer and JB2A are active (plain text field otherwise)
 * - any other String: a text field
 *
 * `label` on a declaration replaces the setting's name in the form, for a field inside a
 * group whose heading already says half of it.
 *
 * Every field has a reset button: back to the setting's default. "Reset Defaults" in the
 * footer does that for every field in the window. Neither stores anything: the form is saved
 * by its Save button, as always.
 *
 * A GM sees everything. A player sees the per-client settings, since those are the ones a
 * player can change, and below them, when the GM allows it ("playerEffects"), a section for
 * the player's own effect choices: every setting declared with `player: true`, grouped as the
 * GM's are. Those are saved to the player's User flags, not to settings
 * (scripts/effect-choices.js). A blank field there means "use the GM's", which the field shows
 * as its placeholder, and its reset button blanks it. A second button fills in "none": no
 * border, no animation, or the token's own ring color, whatever the GM set.
 *
 * The GM's "Player choices" box also says which players have choices stored and can remove
 * them all. That one acts at once, after a confirmation, since it writes to the players' User
 * documents and not to this form.
 *
 * A feature with `requires: "animations"` is left out while Sequencer and JB2A are not both
 * active, on the GM's side and the player's, and a note at the top says so and links to them.
 */
export class StellarAttunementSettings extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings`,
    tag: "form",
    classes: ["osa-settings"],
    window: {
      title: "Outrider's Stellar Attunement",
      icon: "fa-solid fa-sun",
      contentClasses: ["standard-form"],
    },
    position: { width: 600 },
    form: {
      handler: StellarAttunementSettings.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      pick: StellarAttunementSettings.#onPick,
      preview: StellarAttunementSettings.#onPreview,
      reset: StellarAttunementSettings.#onReset,
      resetAll: StellarAttunementSettings.#onResetAll,
      none: StellarAttunementSettings.#onNone,
      clearPlayers: StellarAttunementSettings.#onClearPlayers,
    },
  };

  /** False for a feature whose settings are left out: one that needs modules this world lacks. */
  static #shown(feature) {
    return feature.requires !== "animations" || animationModulesActive();
  }

  /** The setting keys of a feature that this user may change. */
  static #keys(feature) {
    if (!StellarAttunementSettings.#shown(feature)) return [];
    return Object.keys(feature.settings ?? {}).filter((key) => game.user.isGM || feature.settings[key].scope === "client");
  }

  /** The setting keys of a feature that this user may make their own choice for. */
  static #playerKeys(feature) {
    if (game.user.isGM || !playerEffectsOn() || !StellarAttunementSettings.#shown(feature)) return [];
    return Object.keys(feature.settings ?? {}).filter((key) => feature.settings[key].player);
  }

  /** The modules whose absence hides settings from this user, by name. Empty: nothing is hidden. */
  static #missing() {
    const hides = activeFeatures().some((feature) => feature.requires === "animations");
    if (!hides || animationModulesActive() || !(game.user.isGM || playerEffectsOn())) return [];
    return [sequencerActive() ? null : "Sequencer", jb2aActive() ? null : "JB2A"].filter(Boolean);
  }

  /** Features that have something to show, as [feature, settings helper] pairs, registry order. */
  static #features() {
    return activeFeatures()
      .filter((feature) => StellarAttunementSettings.#keys(feature).length)
      .map((feature) => [feature, featureSettings(feature.id)]);
  }

  /** The player's own section: one box per group of each feature that has player settings. */
  static #playerContext(pickers) {
    const groups = [];
    for (const feature of activeFeatures()) {
      const keys = StellarAttunementSettings.#playerKeys(feature);
      if (!keys.length) continue;
      const settings = featureSettings(feature.id);
      const field = (key) => ({
        key: `${PLAYER}${settings.fullKey(key)}`,
        data: feature.settings[key],
        value: storedChoice(game.user, key) ?? "",
        inherit: settings.get(key),
        player: true,
        pickers,
      });
      const grouped = new Set();
      for (const [id, group] of Object.entries(feature.groups ?? {})) {
        const mine = group.keys.filter((key) => keys.includes(key));
        mine.forEach((key) => grouped.add(key));
        if (mine.length) groups.push({ id: `${feature.id}-${id}`, label: `${feature.label ?? feature.id}: ${group.label}`, fields: mine.map(field) });
      }
      const loose = keys.filter((key) => !grouped.has(key));
      if (loose.length) groups.push({ id: feature.id, label: feature.label ?? feature.id, fields: loose.map(field) });
    }
    return groups.length ? { groups } : null;
  }

  async _prepareContext() {
    const pickers = pickerAvailable();
    return {
      missing: StellarAttunementSettings.#missing(),
      player: StellarAttunementSettings.#playerContext(pickers),
      features: StellarAttunementSettings.#features().map(([feature, settings]) => {
        const field = (key) => ({ key: settings.fullKey(key), data: feature.settings[key], value: settings.get(key), pickers });
        const shown = StellarAttunementSettings.#keys(feature);
        // A key a group names but this user does not see is skipped, and an empty group with it.
        const groups = Object.entries(feature.groups ?? {})
          .map(([id, group]) => ({ id, label: group.label, fields: group.keys.filter((key) => shown.includes(key)).map(field) }))
          .filter((group) => group.fields.length);
        const grouped = new Set(Object.values(feature.groups ?? {}).flatMap((group) => group.keys));
        return {
          id: feature.id,
          label: feature.label ?? feature.id,
          hint: feature.hint ?? "",
          fields: shown.filter((key) => !grouped.has(key)).map(field),
          groups,
        };
      }),
    };
  }

  /** Listeners of the last render, dropped when the window renders again. */
  #listeners = null;

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element;
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const signal = this.#listeners.signal;
    // The mouse wheel scrolls the window, it never changes a value the pointer happens to cross.
    form.addEventListener("wheel", (event) => {
      if (event.target.closest?.("range-picker, input[type=number], select")) {
        event.stopImmediatePropagation();
        event.target.blur?.();
      }
    }, { capture: true, passive: true, signal });
    // Mark each field that differs from what the window opened with, and dim the reset button
    // of a field that is at its default already.
    const named = [...form.elements].filter((el) => el.name);
    const start = new Map(named.map((el) => [el.name, read(el)]));
    const sync = (el) => {
      if (!el || !start.has(el.name)) return;
      const group = el.closest(".form-group");
      group?.classList.toggle("osa-changed", !same(read(el), start.get(el.name)));
      const reset = group?.querySelector('button[data-action="reset"]');
      if (reset) reset.disabled = same(read(el), StellarAttunementSettings.#defaultOf(el.name));
    };
    // A slider or a color field reports from an input inside it: go by the named field around it.
    const onEdit = (event) => sync(event.target.closest?.("[name]"));
    form.addEventListener("input", onEdit, { signal });
    form.addEventListener("change", onEdit, { signal });
    named.forEach(sync);
  }

  /** The setting key behind a form field name. */
  static #settingKey(name) {
    return name.startsWith(PLAYER) ? name.slice(PLAYER.length) : name;
  }

  /** What a field's reset button puts back: the setting's default, or blank for a player's own choice. */
  static #defaultOf(name) {
    if (name.startsWith(PLAYER)) return "";
    return game.settings.settings.get(`${MODULE_ID}.${name}`)?.default;
  }

  /** A small button beside a field. */
  static #button(action, key, icon, tooltip) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `icon osa-${action}`;
    el.dataset.action = action;
    el.dataset.key = key;
    el.dataset.tooltip = tooltip;
    el.ariaLabel = tooltip;
    const i = document.createElement("i");
    i.className = icon;
    el.append(i);
    return el;
  }

  /** The input for a player's own choice: always something that can be left blank. */
  static #playerControl({ key, data, value, inherit, pickers }, id) {
    const button = StellarAttunementSettings.#button;
    const reset = button("reset", key, "fa-solid fa-rotate-left", "Clear: use the GM's setting");
    // "blank", not "none": none is what a player picks, blank is a setting the GM left empty.
    const hint = inherit === "" || inherit === null || inherit === undefined ? "GM: blank" : `GM: ${inherit}`;
    // Fills in the word a player stores to have nothing here, where blank would mean the GM's.
    const none = (what) => button("none", key, "fa-solid fa-ban", `None: ${what}, whatever the GM set`);
    if (data.color) {
      // The element builds its text field when it joins the page, from this attribute.
      return [HTMLColorPickerElement.create({ id, name: key, value: value ?? "", placeholder: hint }), none("the token's own color"), reset];
    }
    const input = document.createElement("input");
    Object.assign(input, { id, name: key, placeholder: hint });
    if (data.type === Number) {
      input.type = "number";
      if (data.range) Object.assign(input, { min: data.range.min, max: data.range.max, step: data.range.step });
      input.value = value ?? "";
      return [input, reset];
    }
    input.type = "text";
    input.value = value ?? "";
    // What a blank field plays: the picker and the preview fall back to it.
    input.dataset.inherit = inherit ?? "";
    const off = none(data.picker === "border" ? "no border" : "no animation");
    if (!data.picker || !pickers) return [input, off, reset];
    return [input, button("pick", key, "fa-solid fa-film", "Browse the Sequencer database"), button("preview", key, "fa-solid fa-play", "Play on a token (only you see it)"), off, reset];
  }

  /** The input for one setting, then its buttons. */
  static #control(field, id) {
    if (field.player) return StellarAttunementSettings.#playerControl(field, id);
    const { key } = field;
    const shown = StellarAttunementSettings.#defaultOf(key);
    const tooltip = `Reset to default: ${typeof shown === "boolean" ? (shown ? "on" : "off") : field.data.choices?.[shown] ?? (shown === "" ? "blank" : shown)}`;
    return [...StellarAttunementSettings.#input(field, id), StellarAttunementSettings.#button("reset", key, "fa-solid fa-rotate-left", tooltip)];
  }

  static #input({ key, data, value, pickers }, id) {
    if (data.choices) {
      const select = document.createElement("select");
      for (const [choice, text] of Object.entries(data.choices)) {
        const option = document.createElement("option");
        option.value = choice;
        option.textContent = text;
        option.selected = choice === value;
        select.append(option);
      }
      return [Object.assign(select, { id, name: key })];
    }
    if (data.type === Boolean) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = value === true;
      return [Object.assign(input, { id, name: key })];
    }
    if (data.type === Number && data.range) {
      return [HTMLRangePickerElement.create({ id, name: key, value, ...data.range })];
    }
    if (data.color) {
      return [HTMLColorPickerElement.create({ id, name: key, value: value ?? "" })];
    }
    const input = document.createElement("input");
    input.type = data.type === Number ? "number" : "text";
    input.value = value ?? "";
    Object.assign(input, { id, name: key });
    if (!data.picker || !pickers) return [input];
    const button = StellarAttunementSettings.#button;
    return [input, button("pick", key, "fa-solid fa-film", "Browse the Sequencer database"), button("preview", key, "fa-solid fa-play", "Play on a token (only you see it)")];
  }

  static #field(field) {
    const { key, data } = field;
    const group = document.createElement("div");
    group.className = "form-group";

    const id = `${MODULE_ID}-${key.replace(/\W+/g, "-")}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = data.label ?? data.name;
    if (data.scope === "client") {
      const mark = document.createElement("i");
      mark.className = "fa-solid fa-user osa-client";
      mark.dataset.tooltip = "Saved for you, in this browser";
      label.append(" ", mark);
    }

    const fields = document.createElement("div");
    fields.className = "form-fields";
    fields.append(...StellarAttunementSettings.#control(field, id));

    group.append(label, fields);
    // A player's own choice has no hint of its own: the section says what blank means, and the
    // field shows the GM's value.
    if (!field.player) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = data.hint ?? "";
      group.append(hint);
    }
    return group;
  }

  /** One named box of fields. */
  static #box(group) {
    const box = document.createElement("fieldset");
    box.className = "osa-group";
    box.dataset.group = group.id;
    const heading = document.createElement("legend");
    heading.textContent = group.label;
    box.append(heading, ...group.fields.map(StellarAttunementSettings.#field));
    return box;
  }

  /** The fieldset for one feature: its own fields, then one fainter box per group. */
  static #fieldset(feature) {
    const fieldset = document.createElement("fieldset");
    fieldset.dataset.feature = feature.id;
    const legend = document.createElement("legend");
    legend.textContent = feature.label;
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = feature.hint;
    fieldset.append(legend, hint, ...feature.fields.map(StellarAttunementSettings.#field), ...feature.groups.map(StellarAttunementSettings.#box));
    if (feature.id === "playerEffects" && game.user.isGM) fieldset.append(StellarAttunementSettings.#playersRow());
    return fieldset;
  }

  /** For the GM: which players have choices stored, and a button that removes them all. */
  static #playersRow() {
    const users = playersWithChoices();
    const group = document.createElement("div");
    group.className = "form-group osa-players";
    const label = document.createElement("label");
    label.textContent = "Choices players have saved";
    const fields = document.createElement("div");
    fields.className = "form-fields";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.dataset.action = "clearPlayers";
    clear.disabled = !users.length;
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-user-xmark";
    clear.append(icon, " Clear all");
    fields.append(clear);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = users.length
      ? `Saved by: ${users.map((user) => user.name).join(", ")}. Clear all removes them for good, so every token and attack is back on the settings above. It acts at once and does not wait for Save Changes.`
      : "No player has saved a choice.";
    group.append(label, fields, hint);
    return group;
  }

  /** The player's own choices, when the GM allows them. */
  static #playerFieldset(player) {
    const fieldset = document.createElement("fieldset");
    fieldset.dataset.feature = "player";
    const legend = document.createElement("legend");
    legend.textContent = "Your effects";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Your own choices, and everyone sees them. Borders, ring colors and attack animations follow your assigned character, or a character only you own, whoever rolls for it. A blank field uses the GM's setting, shown in the field. The crossed circle sets a field to none: no border, no animation, or the token's own ring color.";
    fieldset.append(legend, hint, ...player.groups.map(StellarAttunementSettings.#box));
    return fieldset;
  }

  /** Says which settings are left out because a module is not active, and where to get it. */
  static #note(missing) {
    const note = document.createElement("p");
    note.className = "osa-note";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-circle-info";
    const which = missing.length > 1 ? "neither is" : `${missing[0]} is not`;
    note.append(icon, ` Token border and attack animation options are not shown. They need Sequencer and JB2A, and ${which} active in this world.`);
    for (const name of missing) {
      const link = document.createElement("a");
      Object.assign(link, { href: PACKAGES[name].url, target: "_blank", rel: "noopener", textContent: PACKAGES[name].label });
      note.append(" ", link, ".");
    }
    return note;
  }

  async _renderHTML(context) {
    const footer = document.createElement("footer");
    footer.className = "form-footer";
    const save = document.createElement("button");
    save.type = "submit";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-floppy-disk";
    save.append(icon, " Save Changes");
    // Every field back to its default, in the form only: Save Changes stores it, closing the
    // window drops it. The same wording and place as Foundry's own settings window.
    const reset = document.createElement("button");
    reset.type = "button";
    reset.dataset.action = "resetAll";
    reset.dataset.tooltip = "Every field in this window back to its default. Nothing is stored until you save.";
    const resetIcon = document.createElement("i");
    resetIcon.className = "fa-solid fa-arrow-rotate-left";
    reset.append(resetIcon, " Reset Defaults");
    footer.append(reset, save);

    // The fieldsets scroll inside the window; the Save button stays in view.
    const list = document.createElement("div");
    list.className = "osa-categories scrollable";
    if (context.missing.length) list.append(StellarAttunementSettings.#note(context.missing));
    list.append(...context.features.map(StellarAttunementSettings.#fieldset));
    if (context.player) list.append(StellarAttunementSettings.#playerFieldset(context.player));
    return [list, footer];
  }

  _replaceHTML(result, content) {
    content.replaceChildren(...result);
  }

  /** The declaration of a setting, by key. */
  static #declaration(key) {
    for (const feature of activeFeatures()) if (feature.settings?.[key]) return feature.settings[key];
    return null;
  }

  /**
   * What a preview needs from the form as it stands now, saved or not. A player's form has
   * their own scale field, which may be blank, and no layer field: the GM's settings fill in.
   */
  #previewOptions(name) {
    const player = name.startsWith(PLAYER);
    const linked = StellarAttunementSettings.#declaration(StellarAttunementSettings.#settingKey(name))?.previewWith ?? {};
    const form = this.element;
    const options = {};
    if (linked.scale) {
      const own = form.elements[`${player ? PLAYER : ""}${linked.scale}`]?.value;
      const scale = Number(own === "" || own === undefined || own === null ? game.settings.get(MODULE_ID, linked.scale) : own);
      if (Number.isFinite(scale) && scale > 0) options.scale = scale;
    }
    if (linked.below) {
      const below = form.elements[linked.below];
      options.below = below ? below.checked : game.settings.get(MODULE_ID, linked.below) === true;
    }
    return options;
  }

  /** The path a field stands for: what is typed in it, else what a blank field inherits. */
  static #pathOf(input) {
    return input.value.trim() || input.dataset.inherit?.trim() || "";
  }

  /** True for a player's field that holds "none". */
  static #isNone(input) {
    return input.name.startsWith(PLAYER) && String(input.value ?? "").trim().toLowerCase() === NONE;
  }

  /** Browse button: pick a database path into the field. Nothing is saved until the form is. */
  static #onPick(_event, target) {
    const key = target.dataset.key;
    const input = this.element.elements[key];
    const data = StellarAttunementSettings.#declaration(StellarAttunementSettings.#settingKey(key));
    // Beside this window where there is room, so the form stays in view.
    const { left, top, width } = this.position;
    const beside = left + width + 8 + 520 <= window.innerWidth ? left + width + 8 : Math.max(8, left - 520 - 8);
    new AnimationPicker({
      position: { left: beside, top },
      kind: data.picker,
      // From "none" there is no path to open on: start from what the GM has.
      current: StellarAttunementSettings.#isNone(input) ? input.dataset.inherit?.trim() ?? "" : StellarAttunementSettings.#pathOf(input),
      label: data.name,
      previewOptions: () => this.#previewOptions(key),
      onPick: (path) => {
        input.value = path;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
    }).render({ force: true });
  }

  /** Play button: the path in the field, played once on a token. */
  static #onPreview(_event, target) {
    const key = target.dataset.key;
    const data = StellarAttunementSettings.#declaration(StellarAttunementSettings.#settingKey(key));
    const input = this.element.elements[key];
    if (StellarAttunementSettings.#isNone(input)) return ui.notifications.info("This field is set to none: nothing plays.");
    return playPreview(data.picker, StellarAttunementSettings.#pathOf(input), this.#previewOptions(key));
  }

  /** Puts a value in a field the way a hand edit would, so the changed mark and the reset button follow. */
  static #write(el, value) {
    if (el.type === "checkbox") el.checked = value === true;
    else el.value = value ?? "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** Reset button: the field goes back to its default. Nothing is saved until the form is. */
  static #onReset(_event, target) {
    const el = this.element.elements[target.dataset.key];
    if (el) StellarAttunementSettings.#write(el, StellarAttunementSettings.#defaultOf(el.name));
  }

  /** Reset Defaults: every field of the form goes back to its default. Nothing is saved until the form is. */
  static #onResetAll() {
    for (const el of [...this.element.elements].filter((field) => field.name)) {
      if (!same(read(el), StellarAttunementSettings.#defaultOf(el.name))) StellarAttunementSettings.#write(el, StellarAttunementSettings.#defaultOf(el.name));
    }
  }

  /** None button on a player's field. */
  static #onNone(_event, target) {
    const el = this.element.elements[target.dataset.key];
    if (el) StellarAttunementSettings.#write(el, NONE);
  }

  /** Clear all: the stored choices of every player, removed at once after a confirmation. */
  static async #onClearPlayers(_event, target) {
    const users = playersWithChoices();
    if (!users.length) return;
    // User names go into markup: escaped first.
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Clear players' choices" },
      content: `<p>Remove the effect choices saved by ${esc(users.map((user) => user.name).join(", "))}?</p><p>Their tokens and attacks go back to the GM's settings. This cannot be undone.</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;
    await clearChoices(users);
    // Only this row is redrawn: the rest of the form may hold edits that are not saved yet.
    target.closest(".form-group")?.replaceWith(StellarAttunementSettings.#playersRow());
  }

  /** Write only what changed, and only keys the form showed: a hidden checkbox would read as unticked. */
  static async #onSubmit(_event, _form, formData) {
    const submitted = formData.object;
    for (const [feature, settings] of StellarAttunementSettings.#features()) {
      for (const key of StellarAttunementSettings.#keys(feature)) {
        const data = feature.settings[key];
        const raw = submitted[settings.fullKey(key)];
        let value;
        if (data.type === Boolean) value = raw === true;
        else if (raw === undefined) continue;
        else if (data.type === Number) value = raw === null || raw === "" ? NaN : Number(raw);
        else value = String(raw ?? "").trim(); // a cleared color reads as null
        if (data.type === Number && !Number.isFinite(value)) continue;
        if (settings.get(key) !== value) await settings.set(key, value);
      }
    }
    await StellarAttunementSettings.#savePlayer(submitted);
  }

  /**
   * A player's own choices go to their User flags in one write, null for a blank field. Only
   * the fields the form showed are written: the rest of the flag is left as it is.
   */
  static async #savePlayer(submitted) {
    const next = {};
    let changed = false;
    for (const feature of activeFeatures()) {
      for (const key of StellarAttunementSettings.#playerKeys(feature)) {
        const data = feature.settings[key];
        const raw = submitted[`${PLAYER}${key}`];
        if (raw === undefined) continue;
        let value;
        if (data.type === Number) {
          value = raw === null || raw === "" ? null : Number(raw);
          if (value !== null && !Number.isFinite(value)) continue;
          if (value !== null && data.range) value = Math.min(data.range.max, Math.max(data.range.min, value));
        } else {
          value = String(raw ?? "").trim() || null;
          if (value?.toLowerCase() === NONE) value = NONE;
        }
        next[choiceKey(key)] = value;
        if ((storedChoice(game.user, key) ?? null) !== value) changed = true;
      }
    }
    if (changed) await game.user.setFlag(MODULE_ID, CHOICES_FLAG, next);
  }
}
