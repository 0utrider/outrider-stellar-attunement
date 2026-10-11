import { MODULE_ID } from "../constants.js";
import { activeFeatures } from "../features/index.js";
import { featureSettings } from "../feature-settings.js";
import { AnimationPicker, pickerAvailable, playPreview } from "./animation-picker.js";

const { ApplicationV2 } = foundry.applications.api;
const { HTMLColorPickerElement, HTMLRangePickerElement } = foundry.applications.elements;

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
 * A GM sees everything. A player sees the per-client settings only, since those are the ones
 * a player can change.
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
    },
  };

  /** The setting keys of a feature that this user may change. */
  static #keys(feature) {
    return Object.keys(feature.settings ?? {}).filter((key) => game.user.isGM || feature.settings[key].scope === "client");
  }

  /** Features that have something to show, as [feature, settings helper] pairs, registry order. */
  static #features() {
    return activeFeatures()
      .filter((feature) => StellarAttunementSettings.#keys(feature).length)
      .map((feature) => [feature, featureSettings(feature.id)]);
  }

  async _prepareContext() {
    const pickers = pickerAvailable();
    return {
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

  /** The input for one setting. */
  static #control({ key, data, value, pickers }, id) {
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

    const button = (action, icon, tooltip) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "icon";
      el.dataset.action = action;
      el.dataset.key = key;
      el.dataset.tooltip = tooltip;
      el.ariaLabel = tooltip;
      const i = document.createElement("i");
      i.className = icon;
      el.append(i);
      return el;
    };
    return [input, button("pick", "fa-solid fa-film", "Browse the Sequencer database"), button("preview", "fa-solid fa-play", "Play on a token (only you see it)")];
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

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = data.hint ?? "";

    group.append(label, fields, hint);
    return group;
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
    fieldset.append(legend, hint, ...feature.fields.map(StellarAttunementSettings.#field));
    for (const group of feature.groups) {
      const box = document.createElement("fieldset");
      box.className = "osa-group";
      box.dataset.group = group.id;
      const heading = document.createElement("legend");
      heading.textContent = group.label;
      box.append(heading, ...group.fields.map(StellarAttunementSettings.#field));
      fieldset.append(box);
    }
    return fieldset;
  }

  async _renderHTML(context) {
    const footer = document.createElement("footer");
    footer.className = "form-footer";
    const save = document.createElement("button");
    save.type = "submit";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-floppy-disk";
    save.append(icon, " Save Changes");
    footer.append(save);

    // The fieldsets scroll inside the window; the Save button stays in view.
    const list = document.createElement("div");
    list.className = "osa-categories scrollable";
    list.append(...context.features.map(StellarAttunementSettings.#fieldset));
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

  /** What a preview needs from the form as it stands now, saved or not. */
  #previewOptions(key) {
    const data = StellarAttunementSettings.#declaration(key);
    const form = this.element;
    const options = {};
    const scale = Number(form.elements[data?.previewWith?.scale]?.value);
    if (Number.isFinite(scale) && scale > 0) options.scale = scale;
    const below = form.elements[data?.previewWith?.below];
    if (below) options.below = below.checked;
    return options;
  }

  /** Browse button: pick a database path into the field. Nothing is saved until the form is. */
  static #onPick(_event, target) {
    const key = target.dataset.key;
    const input = this.element.elements[key];
    const data = StellarAttunementSettings.#declaration(key);
    // Beside this window where there is room, so the form stays in view.
    const { left, top, width } = this.position;
    const beside = left + width + 8 + 520 <= window.innerWidth ? left + width + 8 : Math.max(8, left - 520 - 8);
    new AnimationPicker({
      position: { left: beside, top },
      kind: data.picker,
      current: input.value.trim(),
      label: data.name,
      previewOptions: () => this.#previewOptions(key),
      onPick: (path) => {
        input.value = path;
      },
    }).render({ force: true });
  }

  /** Play button: the path in the field, played once on a token. */
  static #onPreview(_event, target) {
    const key = target.dataset.key;
    const data = StellarAttunementSettings.#declaration(key);
    return playPreview(data.picker, this.element.elements[key].value.trim(), this.#previewOptions(key));
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
  }
}
