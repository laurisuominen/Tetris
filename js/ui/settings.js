/**
 * Settings panel.
 *
 * Built from classed elements (no inline styles) so the strict CSP needs no
 * unsafe-inline. Each control reads from and writes back to the validated
 * settings store.
 */

import { el, on } from '../util/dom.js';
import { loadSettings, saveSettings } from '../storage/settingsStore.js';

export function createSettingsUI(overlays, applySettings) {
  let currentSettings = loadSettings();
  applySettings(currentSettings); // apply on boot

  function row(labelText, control) {
    const div = el('div', { className: 'settings-row' });
    const label = el('label', { className: 'settings-row__label', text: labelText });
    // Associate label with control for pointer + screen-reader targeting.
    if (control.id) label.setAttribute('for', control.id);
    div.appendChild(label);
    div.appendChild(control);
    return div;
  }

  const checkbox = (id) => el('input', { attrs: { type: 'checkbox', id } });

  function show() {
    const form = el('div', { className: 'settings-form' });

    const motionSelect = el('select', {
      className: 'settings-control', attrs: { id: 'set-motion' }
    });
    motionSelect.appendChild(el('option', { text: 'Auto', attrs: { value: 'auto' } }));
    motionSelect.appendChild(el('option', { text: 'Off', attrs: { value: 'off' } }));
    motionSelect.value = currentSettings.motion;

    const classicCheck = checkbox('set-classic');
    classicCheck.checked = currentSettings.classicColors;

    const ghostCheck = checkbox('set-ghost');
    ghostCheck.checked = currentSettings.ghostPiece;

    const hapticsCheck = checkbox('set-haptics');
    hapticsCheck.checked = currentSettings.haptics;

    const swipeCheck = checkbox('set-swipe');
    swipeCheck.checked = currentSettings.swipeControls;

    const volInput = el('input', {
      className: 'settings-control',
      attrs: { type: 'range', min: '0', max: '1', step: '0.1', id: 'set-volume' }
    });
    volInput.value = String(currentSettings.volume);

    form.appendChild(row('Reduce motion', motionSelect));
    form.appendChild(row('Classic colours', classicCheck));
    form.appendChild(row('Ghost piece', ghostCheck));
    form.appendChild(row('Volume', volInput));
    form.appendChild(row('Haptics (vibration)', hapticsCheck));
    form.appendChild(row('Swipe gestures', swipeCheck));

    const saveBtn = el('button', { text: 'Save', className: 'btn', attrs: { type: 'button' } });
    const cancelBtn = el('button', { text: 'Cancel', className: 'btn btn--ghost', attrs: { type: 'button' } });

    on(saveBtn, 'click', () => {
      currentSettings = {
        motion: motionSelect.value,
        classicColors: classicCheck.checked,
        ghostPiece: ghostCheck.checked,
        volume: parseFloat(volInput.value),
        haptics: hapticsCheck.checked,
        swipeControls: swipeCheck.checked
      };
      saveSettings(currentSettings);
      applySettings(currentSettings);
      overlays.close();
    });

    on(cancelBtn, 'click', () => overlays.close());

    overlays.open('settings', {
      title: 'Settings',
      body: form,
      buttons: [saveBtn, cancelBtn]
    });
  }

  return { show, getSettings: () => currentSettings };
}
