import './settings.css';

const GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z" /></svg>';

// The settings menu: a gear in the top-left corner that opens a small panel of tabs. It owns only the DOM. Each
// module adds its own tab and rows, in the order they're created, and keeps its own state (remembered with the
// helpers below). Clicks inside the menu never reach the canvas.
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
  const tabs = document.createElement('div');
  tabs.className = 'bh-tabs';
  tabs.setAttribute('role', 'tablist');
  panel.append(tabs);
  root.append(gear, panel);
  document.body.append(root);

  const closers = []; // run whenever the panel closes
  const open = (value) => {
    panel.hidden = !value;
    gear.setAttribute('aria-expanded', String(value));
    root.classList.toggle('open', value);
    if (!value) for (const close of closers) close();
  };
  gear.addEventListener('click', () => {
    gear.blur();
    open(panel.hidden);
  });
  const onOutside = (event) => !root.contains(event.target) && open(false);
  const onKey = (event) => event.code === 'Escape' && open(false);
  window.addEventListener('pointerdown', onOutside);
  window.addEventListener('keydown', onKey);

  // Each tab and the page it shows. The page you were on stays picked while the panel is closed.
  const pages = [];
  const select = (page) => {
    for (const { tab, element } of pages) {
      const picked = element === page;
      element.hidden = !picked;
      tab.setAttribute('aria-selected', String(picked));
    }
  };

  let groups = 0;

  return {
    // A tab and its page, which the other add… calls fill. `touch` ones only show on touch screens.
    addTab(name, { touch = false } = {}) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'bh-tab';
      tab.textContent = name;
      tab.setAttribute('role', 'tab');
      const element = document.createElement('div');
      element.className = 'bh-page';
      element.setAttribute('role', 'tabpanel');
      if (touch) {
        tab.classList.add('bh-touch-only');
        element.classList.add('bh-touch-only');
      }
      tab.addEventListener('click', () => {
        tab.blur(); // a focused tab would be re-clicked by Space
        select(element);
      });
      tabs.append(tab);
      panel.append(element);
      pages.push({ tab, element });
      select(pages[0].element);
      return element;
    },

    // A section of `page` under a small heading, set off from what's above it.
    addGroup(page, heading) {
      const group = document.createElement('div');
      group.className = 'bh-group';
      group.innerHTML = `<div class="bh-heading">${heading}</div>`;
      page.append(group);
      return group;
    },

    // A switch, in `parent` (a page or a group). `onChange(checked)` runs when you flip it.
    addSwitch(parent, label, title, onChange) {
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

    // A button in `parent`, with a key it's bound to (if any) beside its label and a line of small print under
    // it. `onClick()` runs when you press it. Returns the button and the elements holding its label and note.
    addButton(parent, label, key, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bh-action';
      const text = document.createElement('span');
      text.textContent = label;
      const note = document.createElement('small');
      button.append(text);
      if (key) button.append(Object.assign(document.createElement('kbd'), { textContent: key }));
      button.append(note);
      button.addEventListener('click', () => {
        button.blur(); // a focused button would be re-clicked by Space
        onClick();
      });
      parent.append(button);
      return { button, label: text, note };
    },

    // `callback()` runs whenever the panel closes.
    onClose(callback) {
      closers.push(callback);
    },

    close() {
      open(false);
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
