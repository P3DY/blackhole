import './settings.css';

const GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z" /></svg>';

// The settings menu: a gear in the top-left corner that opens a small panel. It owns only the DOM. Each module
// adds its own rows, in the order they're created, and keeps its own state (remembered with the helpers below).
// Clicks inside the menu never reach the canvas.
export function createSettings() {
  const root = document.createElement('div');
  root.className = 'bh-settings';
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'bh-gear';
  gear.title = 'Settings';
  gear.setAttribute('aria-label', 'Settings');
  gear.setAttribute('aria-expanded', 'false');
  gear.innerHTML = GEAR;
  const panel = document.createElement('div');
  panel.className = 'bh-panel';
  panel.hidden = true;
  root.append(gear, panel);
  document.body.append(root);

  const open = (value) => {
    panel.hidden = !value;
    gear.setAttribute('aria-expanded', String(value));
    root.classList.toggle('open', value);
  };
  gear.addEventListener('click', () => {
    gear.blur();
    open(panel.hidden);
  });
  const onOutside = (event) => !root.contains(event.target) && open(false);
  const onKey = (event) => event.code === 'Escape' && open(false);
  window.addEventListener('pointerdown', onOutside);
  window.addEventListener('keydown', onKey);

  let groups = 0;

  return {
    // A switch, in `parent` (the panel, or a group). `onChange(checked)` runs when you flip it.
    addSwitch(label, title, onChange, parent = panel) {
      const row = document.createElement('label');
      row.className = 'bh-switch';
      row.title = title;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => {
        input.blur(); // a focused checkbox would be re-toggled by Space
        onChange(input.checked);
      });
      row.append(input, document.createElement('span'), label);
      parent.append(row);
      return input;
    },

    // A section under a small heading, set off from what's above it. `touch` ones only show on touch screens.
    addGroup(heading, { touch = false } = {}) {
      const group = document.createElement('div');
      group.className = touch ? 'bh-group bh-touch-only' : 'bh-group';
      group.innerHTML = `<div class="bh-heading">${heading}</div>`;
      panel.append(group);
      return group;
    },

    // One radio button per [key, label, title] in `group`. `onPick(key)` runs on every click, even on the
    // current choice. Returns the inputs by key.
    addChoices(group, choices, onPick) {
      const name = `bh-choice-${groups++}`;
      const inputs = {};
      for (const [key, label, title] of choices) {
        const row = document.createElement('label');
        row.className = 'bh-choice';
        row.title = title;
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.addEventListener('click', () => {
          input.blur(); // a focused radio would take the arrow keys from steering
          onPick(key);
        });
        row.append(input, document.createElement('span'), label);
        group.append(row);
        inputs[key] = input;
      }
      return inputs;
    },

    dispose() {
      window.removeEventListener('pointerdown', onOutside);
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}

export function readFlag(storage) {
  try {
    return localStorage.getItem(storage) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(storage, value) {
  writeChoice(storage, value ? '1' : '0');
}

// A stored choice if it's one of `options`, else `fallback` (or the first option, if that isn't one either).
export function readChoice(storage, options, fallback) {
  let value = null;
  try {
    value = localStorage.getItem(storage);
  } catch {
    // unavailable storage just means nothing was stored
  }
  if (options.includes(value)) return value;
  return options.includes(fallback) ? fallback : options[0];
}

export function writeChoice(storage, value) {
  try {
    localStorage.setItem(storage, value);
  } catch {
    // storage can be unavailable (private browsing, file://); the setting just won't stick
  }
}
