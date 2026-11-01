// Carry an explicitly selected workspace into the loaded save, keeping only plans that still fit.
import { withAbilities, validateAbilities, learnedForBuild } from './abilities.js?v=5';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const itemId = value => Number.isSafeInteger(value) && value >= -1;
const abilityIds = value => Array.isArray(value) && value.every(id => Number.isSafeInteger(id) && id > 0);
const META_KEY = 'ffr-companion-workspaces';
const PLANS_KEY = 'ffr-companion-plans:';
const GOALS_KEY = 'ffr-companion-goals:';

function storedObject(storage, key) {
  try { const value = JSON.parse(storage.getItem(key)); return record(value) ? value : {}; }
  catch { return {}; }
}

export function readWorkspace(storage, hash) {
  return { plans: storedObject(storage, PLANS_KEY + hash), goals: storedObject(storage, GOALS_KEY + hash) };
}

/** Discover legacy plans too: metadata is optional, never the source of workspace contents. */
export function workspaceChoices(storage, currentHash) {
  const hashes = new Set(), meta = storedObject(storage, META_KEY);
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      for (const prefix of [PLANS_KEY, GOALS_KEY]) if (typeof key === 'string' && key.startsWith(prefix) && key.length > prefix.length) hashes.add(key.slice(prefix.length));
    }
  } catch { return []; }
  return [...hashes].filter(hash => hash !== currentHash).flatMap(hash => {
    const workspace = readWorkspace(storage, hash);
    if (!Object.keys(workspace.plans).length && !Object.keys(workspace.goals).length) return [];
    const detail = record(meta[hash]) ? meta[hash] : {};
    return [{ hash, fileName: typeof detail.fileName === 'string' && detail.fileName ? detail.fileName : `Save ${hash.slice(0, 8)}`,
      updatedAt: typeof detail.updatedAt === 'string' && Number.isFinite(Date.parse(detail.updatedAt)) ? detail.updatedAt : '' }];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.hash.localeCompare(b.hash));
}

export function rememberWorkspace(storage, source) {
  if (!record(source) || typeof source.sha256 !== 'string' || !source.sha256) return false;
  try {
    const meta = storedObject(storage, META_KEY);
    Object.defineProperty(meta, source.sha256, { value: { fileName: typeof source.fileName === 'string' ? source.fileName : '', updatedAt: new Date().toISOString() }, enumerable: true, configurable: true, writable: true });
    storage.setItem(META_KEY, JSON.stringify(meta));
    return true;
  } catch { return false; }
}

function planShape(plan) {
  if (!record(plan) || !['weaponId', 'armorId', 'visionId'].every(key => itemId(plan[key])) ||
      !Array.isArray(plan.accessoryIds) || !plan.accessoryIds.every(itemId) ||
      (plan.equippedSkillIds !== undefined && !abilityIds(plan.equippedSkillIds))) return 'Plan has invalid equipment or abilities.';
  const locks = plan.locks;
  if (locks !== undefined && (!record(locks) || !['weapon', 'armor', 'vision'].every(key => typeof locks[key] === 'boolean') ||
      !Array.isArray(locks.accessories) || locks.accessories.length !== plan.accessoryIds.length ||
      !locks.accessories.every(on => typeof on === 'boolean') || !abilityIds(locks.skillIds))) return 'Plan has invalid pins.';
  if (locks?.skillIds.some(id => !(plan.equippedSkillIds || []).includes(id))) return 'A pinned ability is not equipped.';
  return '';
}

/** No save writes, storage changes or mutation of the source workspace. */
export function revalidateWorkspace(workspace, { catalog, snapshot, indexes, stats, core, reserve = true }) {
  const plans = {}, goals = {}, issues = [];
  if (!record(workspace) || (workspace.plans !== undefined && !record(workspace.plans)) ||
      (workspace.goals !== undefined && !record(workspace.goals))) {
    return { plans, goals, issues: [{ characterId: 0, reason: 'Workspace has invalid plans or goals.' }] };
  }
  const available = new Set(snapshot.characters.filter(core.joined).map(c => c.id));
  for (const [key, raw] of Object.entries(workspace.plans || {})) {
    const id = Number(key);
    let reason = !Number.isSafeInteger(id) || String(id) !== key || !available.has(id) ? 'Character is not available.' : planShape(raw);
    if (!reason) {
      try {
        const saved = snapshot.characters.find(c => c.id === id);
        const plan = core.withLocks(withAbilities(raw, saved), raw.accessoryIds.length);
        reason = validateAbilities(plan.equippedSkillIds, learnedForBuild(stats, catalog, snapshot, id, plan), indexes);
        if (!reason) plans[id] = plan;
      } catch { reason = 'Abilities could not be validated for this build.'; }
    }
    if (reason) issues.push({ characterId: Number.isSafeInteger(id) ? id : 0, reason });
  }
  // Validate together so valid swaps survive. Removing a plan reinstates its saved reservations.
  while (Object.keys(plans).length) {
    const invalid = [];
    for (const [id, plan] of Object.entries(plans)) {
      let reason;
      try { reason = core.validPlan(catalog, snapshot, Number(id), plan, plans, reserve); }
      catch { reason = 'Plan could not be validated for this save.'; }
      if (reason) invalid.push({ characterId: Number(id), reason });
    }
    if (!invalid.length) break;
    for (const issue of invalid) { delete plans[issue.characterId]; issues.push(issue); }
  }
  const bosses = (catalog.enemies || []).filter(e => e.isBoss).map(e => e.id);
  for (const [id, goal] of Object.entries(workspace.goals || {})) {
    if (String(Number(id)) === id && available.has(Number(id))) goals[id] = core.normalizeGoal(goal, bosses);
  }
  return { plans, goals, issues };
}
