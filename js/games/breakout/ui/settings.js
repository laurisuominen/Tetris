/**
 * Settings panel.
 *
 * Built from classed elements (no inline styles) so the strict CSP needs no
 * unsafe-inline. Each control reads from and writes back to the validated
 * settings store.
 *
 * Speed is a rule, not a preference: it changes what a score means. The panel
 * says so, and the core applies it only on the next start.
 */

import { el, on } from '../../../shared/util/dom.js';
import { loadSettings, saveSettings } from '../storage/settingsStore.js';
import { SPEEDS, SPEED_TABLE } from '../core/constants.js';

export function createSettingsUI(overlays, applySettings) {
  let currentSettings = loadSettings();
  applySettings(currentSettings); // apply on boot

  function row(labelText, control, note) {
    const div = el('div', { className: 'settings-row' });
    const label = el('label', { className: 'settings-row__label', text: labelText });
    // Associate label with control for pointer + screen-reader targeting.
    if (control.id) label.setAttribute('for', control.id);
    div.appendChild(label);
    div.appendChild(control);
    if (note) div.appendChild(el('p', { className: 'settings-row__note', text: note }));
    return div;
  }

  const checkbox = (id) => el('input', { attrs: { type: 'checkbox', id } });

  function show() {
    const form = el('div', { className: 'settings-form' });

    const speedSelect = el('select', {
      className: 'settings-control', attrs: { id: 'set-speed' }
    });
    for (const key of Object.keys(SPEEDS)) {
      const { label, baseSpeed } = SPEED_TABLE[key];
      speedSelect.appendChild(el('option', {
        // Bricks are worth the same at every tier, so the honest label is the
        // speed itself rather than a points multiplier Snake has and this
        // deliberately does not.
        text: `${label} (${baseSpeed} cells/sec)`,
        attrs: { value: key }
      }));
    }
    speedSelect.value = currentSettings.speed;

    const pointerCheck = checkbox('set-pointer');
    pointerCheck.checked = currentSettings.pointerControls;

    const motionSelect = el('select', {
      className: 'settings-control', attrs: { id: 'set-motion' }
    });
    motionSelect.appendChild(el('option', { text: 'Auto', attrs: { value: 'auto' } }));
    motionSelect.appendChild(el('option', { text: 'Off', attrs: { value: 'off' } }));
    motionSelect.value = currentSettings.motion;

    const hapticsCheck = checkbox('set-haptics');
    hapticsCheck.checked = currentSettings.haptics;

    const volInput = el('input', {
      className: 'settings-control',
      attrs: { type: 'range', min: '0', max: '1', step: '0.1', id: 'set-volume' }
    });
    volInput.value = String(currentSettings.volume);

    form.appendChild(row('Speed', speedSelect, 'Applies to your next game.'));
    form.appendChild(row(
      'Pointer paddle', pointerCheck,
      'Paddle follows the mouse or your finger. Off leaves the keys and arrows.'
    ));
    form.appendChild(row('Reduce motion', motionSelect));
    form.appendChild(row('Volume', volInput));
    form.appendChild(row('Haptics (vibration)', hapticsCheck));

    const saveBtn = el('button', { text: 'Save', className: 'btn', attrs: { type: 'button' } });
    const cancelBtn = el('button', { text: 'Cancel', className: 'btn btn--ghost', attrs: { type: 'button' } });

    on(saveBtn, 'click', () => {
      currentSettings = {
        motion: motionSelect.value,
        volume: parseFloat(volInput.value),
        haptics: hapticsCheck.checked,
        pointerControls: pointerCheck.checked,
        speed: speedSelect.value
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
