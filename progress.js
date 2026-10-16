(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RecallProgress = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'drug-memory-recall-v2';
  const LEGACY_KEY = 'drug-memory-full-v1';
  const MAX_BYTES = 5000000;
  const MAX_RECORDS = 10000;
  const MAX_ATTEMPTS = 1000000;
  const MODES = ['fields', 'name'];
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
  const ID = /^[a-z0-9][a-z0-9_-]{0,199}$/;
  const VERSION = /^[a-f0-9]{12}$/;

  function demand(condition) {
    if (!condition) throw new Error('지원하지 않거나 손상된 학습 기록입니다.');
  }

  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  // Inspect even discarded input properties before accepting an external backup.
  function inspect(value) {
    let nodes = 0;
    const ancestors = new Set();
    function visit(item, depth) {
      demand(++nodes <= 150000 && depth <= 20);
      if (typeof item === 'string') demand(item.length <= 100000);
      if (!item || typeof item !== 'object') return;
      demand(Array.isArray(item) || object(item));
      demand(!ancestors.has(item));
      ancestors.add(item);
      const keys = Object.keys(item);
      demand(keys.length <= (Array.isArray(item) ? 30000 : MAX_RECORDS));
      for (const key of keys) {
        demand(!RESERVED.has(key));
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        demand(descriptor && 'value' in descriptor);
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
    }
    visit(value, 0);
    demand(JSON.stringify(value).length <= MAX_BYTES);
    return value;
  }

  function parse(value) {
    if (typeof value === 'string') {
      demand(value.length <= MAX_BYTES);
      value = JSON.parse(value);
    }
    return inspect(value);
  }

  function identifier(value) {
    return typeof value === 'string' && ID.test(value) && !RESERVED.has(value);
  }

  function validVersion(value) {
    return typeof value === 'string' && VERSION.test(value);
  }

  function instant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  }

  function day(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && instant(value + 'T00:00:00.000Z');
  }

  function selectedUnits(value, knownUnits) {
    demand(Array.isArray(value) && value.length <= MAX_RECORDS);
    demand(value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !RESERVED.has(id)));
    const allowed = knownUnits === undefined ? null : new Set(knownUnits);
    return [...new Set(value.filter(id => !allowed || allowed.has(id)))];
  }

  function attempts(value) {
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ATTEMPTS;
  }

  function legacyUnits(settings, knownUnits) {
    if (settings.units !== undefined) return selectedUnits(settings.units, knownUnits);
    demand(typeof settings.unit === 'string' && settings.unit.length <= 500);
    const available = selectedUnits(knownUnits === undefined ? [] : knownUnits);
    const start = settings.unit || 'all';
    // Unit IDs do not carry year metadata, so keep the archive with a safe current scope.
    if (start === 'all' || start.startsWith('year:') || !available.includes(start)) return available;
    const end = available.includes(settings.endUnit) ? settings.endUnit : start;
    const number = id => Number(id.slice(5).split('-')[0]);
    return available.filter(id => number(id) >= number(start) && number(id) <= number(end));
  }

  function cleanLegacy(value, knownUnits) {
    demand(object(value) && value.schema_version === 1 && object(value.settings) && object(value.records));
    demand([1, 2, 3].includes(value.settings.importance));
    const settings = {
      units: legacyUnits(value.settings, knownUnits), importance: value.settings.importance,
    };
    const entries = Object.entries(value.records);
    demand(entries.length <= MAX_RECORDS);
    const records = {};
    for (const [id, rec] of entries) {
      demand(/^drug-[a-z0-9_-]+$/.test(id) && id.length <= 205 && object(rec));
      demand(validVersion(rec.version) && ['review', 'remembered'].includes(rec.status) && attempts(rec.attempts));
      demand(day(rec.last_checked_day) && (rec.last_missed_day === null || day(rec.last_missed_day)));
      demand(Array.isArray(rec.missed_elements) && rec.missed_elements.length <= 100);
      demand(rec.missed_elements.every(item => typeof item === 'string' && item.length <= 3000));
      records[id] = {
        version: rec.version, status: rec.status, attempts: rec.attempts,
        last_checked_day: rec.last_checked_day, last_missed_day: rec.last_missed_day,
        missed_elements: rec.missed_elements.slice(),
      };
    }
    return { schema_version: 1, settings, records };
  }

  function cleanRecord(value, mode) {
    demand(object(value) && validVersion(value.version) && typeof value.correct === 'boolean');
    demand(attempts(value.attempts) && instant(value.checkedAt));
    demand(Array.isArray(value.missedFieldIds) && value.missedFieldIds.length <= 100);
    demand(value.missedFieldIds.every(identifier));
    demand(new Set(value.missedFieldIds).size === value.missedFieldIds.length);
    demand(!value.correct || value.missedFieldIds.length === 0);
    demand(mode !== 'name' || value.missedFieldIds.length === 0);
    return {
      version: value.version, correct: value.correct, attempts: value.attempts,
      checkedAt: value.checkedAt, missedFieldIds: value.missedFieldIds.slice(),
    };
  }

  function cleanState(value, knownUnits) {
    demand(object(value) && value.schemaVersion === 2 && object(value.settings) && object(value.records));
    demand([1, 2, 3].includes(value.settings.minImportance) && MODES.includes(value.settings.mode));
    const settings = {
      unitIds: selectedUnits(value.settings.unitIds, knownUnits),
      minImportance: value.settings.minImportance, mode: value.settings.mode,
    };
    const entries = Object.entries(value.records);
    demand(entries.length <= MAX_RECORDS);
    const records = {};
    for (const [key, value] of entries) {
      const separator = key.indexOf(':');
      const mode = key.slice(0, separator);
      demand(MODES.includes(mode) && identifier(key.slice(separator + 1)));
      records[key] = cleanRecord(value, mode);
    }
    return {
      schemaVersion: 2, settings, records,
      legacy: value.legacy == null ? null : cleanLegacy(value.legacy, knownUnits),
    };
  }

  function fresh(unitIds) {
    return {
      schemaVersion: 2,
      settings: { unitIds: selectedUnits(unitIds), minImportance: 3, mode: 'fields' },
      records: {}, legacy: null,
    };
  }

  function read(storage, unitIds) {
    let state;
    try { state = cleanState(parse(storage.getItem(KEY)), unitIds); }
    catch { state = fresh(unitIds); }
    if (state.legacy === null) {
      try { state.legacy = cleanLegacy(parse(storage.getItem(LEGACY_KEY)), unitIds); }
      catch { /* An unavailable or invalid old key does not block current learning. */ }
    }
    return state;
  }

  function write(storage, state) {
    try {
      storage.setItem(KEY, JSON.stringify(cleanState(inspect(state))));
      return true;
    } catch { return false; }
  }

  function getRecord(state, mode, question) {
    const record = state.records[mode + ':' + question.id];
    return record && record.version === question.version ? record : null;
  }

  function recordResult(state, mode, question, result, nowISO) {
    demand(MODES.includes(mode) && question && identifier(question.id) && validVersion(question.version));
    demand(result && typeof result.correct === 'boolean');
    const checkedAt = nowISO === undefined ? new Date().toISOString() : nowISO;
    demand(instant(checkedAt));
    const next = cleanState(inspect(state));
    const fieldIds = (question.fields || []).map(field => field.id);
    demand(fieldIds.length <= 100 && fieldIds.every(identifier));
    const missed = new Set();
    if (mode === 'fields') {
      for (const field of result.missingFields || []) {
        demand(field && fieldIds.includes(field.id));
        missed.add(field.id);
      }
      if (result.unknown) fieldIds.forEach(id => missed.add(id));
      else if (Array.isArray(result.fields)) {
        for (const id of fieldIds) {
          const field = result.fields.find(field => field.id === id);
          if (!field || !field.remembered || typeof field.typed !== 'string' || !field.typed.trim()) missed.add(id);
        }
      }
    }
    const previous = getRecord(next, mode, question);
    const count = previous ? Math.min(previous.attempts + 1, MAX_ATTEMPTS) : 1;
    next.records[mode + ':' + question.id] = {
      version: question.version, correct: result.correct && !result.unknown && missed.size === 0,
      attempts: count, checkedAt, missedFieldIds: fieldIds.filter(id => missed.has(id)),
    };
    return next;
  }

  function stats(state, mode, records) {
    let seen = 0;
    let review = 0;
    let remembered = 0;
    for (const question of records) {
      const record = getRecord(state, mode, question);
      if (!record) continue;
      seen += 1;
      if (record.correct) remembered += 1;
      else review += 1;
    }
    return { seen, review, remembered };
  }

  function makeBackup(state, nowISO) {
    const exportedAt = nowISO === undefined ? new Date().toISOString() : nowISO;
    demand(instant(exportedAt));
    return {
      format: 'drug-recall-backup', schemaVersion: 2, exportedAt,
      state: cleanState(inspect(state)),
    };
  }

  function restoreBackup(payload, unitIds, currentState) {
    const backup = parse(payload);
    demand(object(backup));
    if (backup.format === 'drug-recall-backup' && backup.schemaVersion === 2) {
      demand(instant(backup.exportedAt));
      return { state: cleanState(backup.state, unitIds), kind: 'current' };
    }
    if (backup.format === 'drug-memory-backup' && backup.schema_version === 1) {
      const legacy = cleanLegacy(backup.state, unitIds);
      const state = currentState === undefined ? fresh(unitIds) : cleanState(inspect(currentState), unitIds);
      state.legacy = legacy;
      return { state, kind: 'legacy' };
    }
    demand(false);
  }

  return { KEY, fresh, read, write, recordResult, getRecord, stats, makeBackup, restoreBackup };
}));
