(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RecallPilotCore = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeName(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase()
      .replace(/[\s\p{Dash_Punctuation}\u2212]/gu, '');
  }

  function gradeName(input, acceptedAnswers) {
    const normalized = normalizeName(input);
    return normalized !== '' && Array.isArray(acceptedAnswers)
      && acceptedAnswers.some(answer => normalizeName(answer) === normalized);
  }

  function selectRecords(records, { unitIds, minImportance = 1, mode = 'fields' } = {}) {
    const selectedUnits = unitIds === undefined ? null : new Set(unitIds);
    return records.filter(record => {
      if (selectedUnits && !selectedUnits.has(record.unitId)) return false;
      if (record.importance < minImportance) return false;
      if (mode === 'name') {
        return typeof record.reverse?.prompt === 'string'
          && record.reverse.prompt.trim() !== ''
          && Array.isArray(record.reverse.acceptedAnswers)
          && record.reverse.acceptedAnswers.some(answer =>
            typeof answer === 'string' && answer.trim() !== '');
      }
      return Array.isArray(record.fields) && record.fields.length > 0;
    });
  }

  function shuffle(items, rng = Math.random) {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(rng() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    return shuffled;
  }

  class PilotSession {
    constructor(records, settings = {}, rng = Math.random) {
      this.mode = settings.mode === 'name' ? 'name' : 'fields';
      this.questions = shuffle(selectRecords(records, { ...settings, mode: this.mode }), rng);
      if (this.questions.length === 0) throw new Error('No questions match the selected settings.');
      this.index = 0;
      this.stage = 'question';
      this.feedback = null;
      this.results = [];
    }

    get total() {
      return this.questions.length;
    }

    get current() {
      return this.questions[this.index];
    }

    reveal({ values = {}, name = '', unknown = false } = {}) {
      if (this.stage !== 'question') return false;
      const normalizedValues = {};
      for (const field of this.current.fields || []) {
        normalizedValues[field.id] = typeof values?.[field.id] === 'string'
          ? values[field.id].trim() : '';
      }
      const submittedName = typeof name === 'string' ? name : '';
      this.feedback = {
        values: normalizedValues,
        name: submittedName,
        unknown: Boolean(unknown),
        correct: this.mode === 'name'
          && gradeName(submittedName, this.current.reverse.acceptedAnswers),
        rememberedIds: [],
      };
      this.stage = 'feedback';
      return true;
    }

    markField(id, checked) {
      if (this.mode !== 'fields' || this.stage !== 'feedback' || this.feedback.unknown) return false;
      if (!this.current.fields.some(field => field.id === id) || !this.feedback.values[id]) return false;
      const remembered = new Set(this.feedback.rememberedIds);
      if (checked) remembered.add(id);
      else remembered.delete(id);
      this.feedback.rememberedIds = Array.from(remembered);
      return true;
    }

    advance() {
      if (this.stage !== 'feedback') return false;
      const question = this.current;
      const feedback = this.feedback;
      const fields = this.mode === 'fields' ? question.fields.map(field => ({
        id: field.id,
        label: field.label,
        answer: field.answer,
        typed: feedback.values[field.id],
        remembered: !feedback.unknown && feedback.rememberedIds.includes(field.id),
      })) : [];
      const missingFields = fields.filter(field => !field.remembered)
        .map(({ id, label, answer }) => ({ id, label, answer }));
      this.results.push({
        id: question.id,
        name: question.name,
        unitLabel: question.unitLabel,
        correct: !feedback.unknown && (this.mode === 'name'
          ? feedback.correct : missingFields.length === 0),
        unknown: feedback.unknown,
        missingFields,
        fields,
        submittedName: feedback.name,
        acceptedAnswers: (question.reverse?.acceptedAnswers || []).slice(),
      });
      this.index += 1;
      this.feedback = null;
      this.stage = this.index < this.total ? 'question' : 'result';
      return true;
    }

    summary() {
      const fieldTotals = new Map();
      for (const result of this.results) {
        for (const field of result.fields) {
          if (!fieldTotals.has(field.id)) {
            fieldTotals.set(field.id, { id: field.id, label: field.label, total: 0, remembered: 0 });
          }
          const total = fieldTotals.get(field.id);
          total.total += 1;
          if (field.remembered) total.remembered += 1;
        }
      }
      return {
        total: this.results.length,
        correct: this.results.filter(result => result.correct).length,
        missed: this.results.filter(result => !result.correct),
        fieldTotals: Array.from(fieldTotals.values()),
      };
    }
  }

  return { normalizeName, gradeName, selectRecords, shuffle, PilotSession };
}));
