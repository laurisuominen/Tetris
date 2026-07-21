import { el, on } from '../util/dom.js';
import { loadSettings, saveSettings } from '../storage/settingsStore.js';

export function createSettingsUI(overlays, applySettings) {
  let currentSettings = loadSettings();
  applySettings(currentSettings); // apply on boot

  function show() {
    const container = el('div', { className: 'settings-form' });
    
    // Helper to create a row
    const row = (label, input) => {
      const div = el('div', { attrs: { style: 'margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;' } });
      div.appendChild(el('span', { text: label }));
      div.appendChild(input);
      container.appendChild(div);
      return input;
    };

    const motionSelect = el('select', { attrs: { style: 'background: var(--bg-surface); color: inherit; border: 1px solid var(--border); padding: 4px; border-radius: 4px;' } });
    motionSelect.appendChild(el('option', { text: 'Auto', attrs: { value: 'auto' } }));
    motionSelect.appendChild(el('option', { text: 'Off', attrs: { value: 'off' } }));
    motionSelect.value = currentSettings.motion;
    row('Motion:', motionSelect);

    const classicCheck = el('input', { attrs: { type: 'checkbox' } });
    classicCheck.checked = currentSettings.classicColors;
    row('Classic Colors:', classicCheck);

    const ghostCheck = el('input', { attrs: { type: 'checkbox' } });
    ghostCheck.checked = currentSettings.ghostPiece;
    row('Ghost Piece:', ghostCheck);

    const volInput = el('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.1' } });
    volInput.value = currentSettings.volume;
    row('Volume:', volInput);

    const saveBtn = el('button', { text: 'Save', className: 'btn', attrs: { type: 'button' } });
    const cancelBtn = el('button', { text: 'Cancel', className: 'btn btn--ghost', attrs: { type: 'button' } });

    on(saveBtn, 'click', () => {
      const newSettings = {
        motion: motionSelect.value,
        classicColors: classicCheck.checked,
        ghostPiece: ghostCheck.checked,
        volume: parseFloat(volInput.value)
      };
      currentSettings = newSettings;
      saveSettings(newSettings);
      applySettings(newSettings);
      overlays.close();
    });

    on(cancelBtn, 'click', () => {
      overlays.close();
    });

    overlays.open('settings', {
      title: 'Settings',
      body: container,
      buttons: [saveBtn, cancelBtn]
    });
  }

  return { show, getSettings: () => currentSettings };
}
