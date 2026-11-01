(function (root) {
  'use strict';
  const abilityMaps = {ActiveSkill: 'skills', PassiveSkill: 'passives', MasterSkill: 'masterSkills'};
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const threshold = stage => Number(stage.requiredPoints ?? stage.masteryPoint);
  const delta = (before, after) => finite(before) && finite(after) ? after - before : null;

  function candidates(catalog, snapshot, characterId, {stats}, build) {
    const learned = stats.learned(catalog, snapshot, characterId, Number(build?.visionId) > 0 ? Number(build.visionId) : -1);
    const known = new Set([...(learned.learnedActiveIds || []), ...(learned.learnedPassiveIds || []), ...(learned.masterSkillIds || [])]);
    const records = Object.fromEntries(Object.values(abilityMaps).map(key => [key, new Set((catalog[key] || []).map(row => row.id))]));
    const knownGrant = grant => grant.type === 'BaseParameter' || records[abilityMaps[grant.type]]?.has(grant.id);
    const visions = new Map((catalog.visions || []).map(vision => [vision.id, vision])), seen = new Set(), result = [];
    for (const owned of snapshot.resonances || []) {
      const vision = visions.get(owned.id);
      if (!vision || seen.has(vision.id)) continue;
      seen.add(vision.id);
      const current = Number((owned.sync || []).find(row => Number(row.characterId) === Number(characterId))?.points || 0);
      if (!Number.isFinite(current)) continue;
      const stages = (vision.synchro || []).filter(stage => Number.isFinite(threshold(stage)) && threshold(stage) > current)
        .sort((a, b) => threshold(a) - threshold(b));
      const target = stages.find(stage => (stage.grants || []).some(grant => abilityMaps[grant.type] && knownGrant(grant) && !known.has(grant.id)));
      if (!target) continue;
      const required = threshold(target);
      const earlier = stages.filter(stage => threshold(stage) < required && (stage.grants || []).some(knownGrant));
      result.push({visionId: vision.id, visionName: vision.name, kind: 'Sync', current, required, remaining: required - current,
        priorRequired: earlier.length ? threshold(earlier[earlier.length - 1]) : null,
        rewards: structuredClone(stages.filter(stage => threshold(stage) <= required).flatMap(stage => stage.grants || []).filter(knownGrant))});
    }
    return result;
  }

  function recommend(catalog, snapshot, characterId, build, enemy, options = {}, {core, stats, battle}, progress = () => {}) {
    const result = {results: [], checked: 0, total: 0, unscored: 0, timedOut: false, evaluations: 0, baseline: null, scenario: null, modelEvidence: {}, reason: ''};
    const started = Date.now(), timeMs = finite(options.timeMs) ? Math.max(0, options.timeMs) : 8000;
    const maxEvaluations = finite(options.maxEvaluations) ? Math.max(0, Math.floor(options.maxEvaluations)) : 26;
    let next;
    const stopped = () => Date.now() - started >= timeMs || result.evaluations >= maxEvaluations;
    try {
      const invalid = core.validPlan(catalog, snapshot, characterId, build, {}, false);
      if (invalid) { result.reason = invalid; return result; }
      next = candidates(catalog, snapshot, characterId, {core, stats}, build);
    } catch (error) { result.reason = error?.message || 'The current build could not be checked.'; return result; }
    result.total = next.length;
    if (!next.length) return result;
    if (stopped()) { result.timedOut = true; return result; }
    const modelOptions = {...options, includeSupportOptions: false};
    const evaluate = model => {
      const evaluation = model.evaluate({characterId, visionId: build.visionId, equipment: structuredClone(build), lockedSkillIds: [...(build.locks?.skillIds || [])]});
      return evaluation ? {...evaluation, warnings: [...new Set([...(model.globalWarnings || []), ...(evaluation.warnings || [])])]} : evaluation;
    };
    const atPoints = (candidate, points) => {
      const future = structuredClone(snapshot), owned = future.resonances.find(row => row.id === candidate.visionId);
      owned.sync ||= [];
      let sync = owned.sync.find(row => Number(row.characterId) === Number(characterId));
      if (!sync) { sync = {characterId, points: 0}; owned.sync.push(sync); }
      sync.points = points;
      result.evaluations++;
      return evaluate(battle.createModel(catalog, future, enemy, {...modelOptions}));
    };
    try {
      progress('Checking your current build before comparing Sync unlocks…');
      result.evaluations++;
      const model = battle.createModel(catalog, snapshot, enemy, {...modelOptions});
      result.baseline = evaluate(model); result.scenario = model.scenario; result.modelEvidence = model.evidence || {};
      if (!result.baseline?.valid || !finite(result.baseline.score)) {
        result.reason = result.baseline?.reason || 'The current build could not be scored.';
        result.unscored = result.total; return result;
      }
    } catch (error) {
      result.reason = error?.message || 'The current build could not be scored.';
      result.unscored = result.total; return result;
    }
    for (const candidate of next) {
      if (stopped()) { result.timedOut = true; break; }
      progress(`Checking Sync unlock ${result.checked + 1} of ${result.total}: ${candidate.visionName}…`);
      result.checked++;
      try {
        const evaluation = atPoints(candidate, candidate.required);
        if (!evaluation?.valid || !finite(evaluation.score)) { result.unscored++; continue; }
        const scoreDelta = evaluation.score - result.baseline.score;
        if (!finite(scoreDelta) || scoreDelta <= 0) continue;
        let earlier = result.baseline;
        if (candidate.priorRequired !== null) {
          if (stopped()) { result.timedOut = true; result.unscored++; break; }
          progress(`Checking whether ${candidate.visionName}’s target milestone adds to its earlier rewards…`);
          earlier = atPoints(candidate, candidate.priorRequired);
          if (!earlier?.valid || !finite(earlier.score)) { result.unscored++; continue; }
        }
        const milestoneScoreDelta = evaluation.score - earlier.score;
        if (!finite(milestoneScoreDelta) || milestoneScoreDelta <= 0) continue;
        result.results.push({...candidate, scoreDelta, milestoneScoreDelta, earlierScore: earlier.score,
          beforeScore: result.baseline.score, afterScore: evaluation.score,
          damageDelta: delta(result.baseline.fightDamage ?? result.baseline.damage, evaluation.fightDamage ?? evaluation.damage),
          staggerDelta: delta(result.baseline.fightBreakDamage ?? result.baseline.breakDamage, evaluation.fightBreakDamage ?? evaluation.breakDamage), evaluation});
      } catch { result.unscored++; }
    }
    result.results.sort((a, b) => b.scoreDelta - a.scoreDelta || a.remaining - b.remaining || a.visionId - b.visionId);
    result.results = result.results.slice(0, 3);
    return result;
  }

  const api = {candidates, recommend};
  if (typeof module !== 'undefined') module.exports = api;
  else root.CompanionUnlocks = api;
})(typeof self !== 'undefined' ? self : globalThis);
