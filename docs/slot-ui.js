// One equipment or Resonance slot: the current piece with what it does, and (when open) every choice with its change.
import { h } from './build-details.js?v=12';

const para = (cls, text) => text ? `<p class="${cls}">${h(text)}</p>` : '';
const effects = list => (list || []).map(e => `<p class="dim small"><b>${h(e.name)}</b>${e.text ? ` — ${h(e.text)}` : ''}</p>`).join('');
const piece = p => `<strong>${h(p.name)}</strong>${p.statsText ? ` <span class="dim small">${h(p.statsText)}</span>` : ''}${para('dim small', p.text)}${effects(p.effects)}`;

export function renderSlot({ key, label, current, locked, open, choices, changed = false }) {
  const k = h(key);
  return `<section class="slot${changed ? ' changed' : ''}">
    <div class="slot-head"><span class="dim small">${h(label)}</span>
      <button type="button" class="ghost" data-lock="${k}" aria-pressed="${locked ? 'true' : 'false'}" title="Keep this when building">${locked ? 'Locked' : 'Lock'}</button>
      <button type="button" class="ghost" data-open-slot="${k}" data-key="slot-${k}" aria-expanded="${open ? 'true' : 'false'}">Change</button></div>
    <div class="slot-current">${piece(current)}</div>
    ${open ? `<div class="choices">${(choices || []).map(c => `<button type="button" class="choice" data-pick-slot="${k}" data-id="${h(c.id)}">
      <strong>${h(c.name)}</strong>${c.statsText ? ` <span class="dim small">${h(c.statsText)}</span>` : ''}${c.delta ? ` <em class="delta">${h(c.delta)}</em>` : ''}${para('dim small', c.text)}${effects(c.effects)}</button>`).join('')}</div>` : ''}
  </section>`;
}
