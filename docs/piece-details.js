// The game's own words for a piece of gear or an ability, looked up from the catalog indexes.
import { description } from './build-details.js';

const find = (indexes, kind, id) => indexes[kind]?.get(Number(id));

/** An item's description plus what each passive it carries does. */
export function describeItem(item, indexes) {
  const effects = (item?.passiveIds || []).map(id => find(indexes, 'passives', id)).filter(Boolean)
    .map(p => ({ name: p.name, text: description(p, indexes) }));
  return { id: item?.id, name: item?.name, text: String(item?.description || ''), effects };
}

/** A skill, passive or master skill by id; null when the id is in none of them. */
export function describeAbility(id, indexes) {
  for (const [kind, map] of [['active', 'skills'], ['passive', 'passives'], ['master', 'masterSkills']]) {
    const a = find(indexes, map, id);
    if (a) return { id: a.id, name: a.name, kind, cost: Number(a.equipCost) || 0, text: description(a, indexes) };
  }
  return null;
}
