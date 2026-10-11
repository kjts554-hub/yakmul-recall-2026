(() => {
  'use strict';
  const BANK = (window.QUESTION_BANK || []).filter(q => q.review_status === 'editor_reviewed');
  const BY_ID = new Map(BANK.map(q => [q.id, q]));
  const KEY = 'drug-memory-full-v1';
  const $ = id => document.getElementById(id);
  const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fresh = () => ({schema_version:1, settings:{unit:'all', importance:3}, records:{}, session:null});
  let state = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!validState(value)) return fresh();
      if (!sessionMatchesBank(value.session)) value.session = null;
      if (!unitExists(value.settings.unit)) value.settings.unit = 'all';
      return value;
    } catch { return fresh(); }
  })();

  function sessionMatchesBank(s) {
    return !s || s.ids.every((id,i) => BY_ID.get(id)?.version === s.versions[i]);
  }
  function unitExists(unit) {
    return ['all','year:2025','year:2026', ...BANK.map(q => q.unit_id)].includes(unit);
  }

  function validState(value) {
    if (!value || value.schema_version !== 1 || !value.settings || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return false;
    if (typeof value.settings.unit !== 'string' || value.settings.unit.length > 500) return false;
    if (![1,2,3].includes(value.settings.importance)) return false;
    for (const [id, rec] of Object.entries(value.records)) {
      if (!/^drug-[a-z0-9_-]+$/.test(id) || !rec || !/^[a-f0-9]{12}$/.test(rec.version) || !['review','remembered'].includes(rec.status)) return false;
      if (!Number.isSafeInteger(rec.attempts) || rec.attempts < 1 || rec.attempts > 1000000) return false;
      if (typeof rec.last_checked_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rec.last_checked_day)) return false;
      if (rec.last_missed_day !== null && (typeof rec.last_missed_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rec.last_missed_day))) return false;
      if (!Array.isArray(rec.missed_elements) || rec.missed_elements.some(s => typeof s !== 'string')) return false;
    }
    const s = value.session;
    if (s === null) return true;
    if (!s || !Array.isArray(s.ids) || !s.ids.length || s.ids.length > 10 || new Set(s.ids).size !== s.ids.length || s.ids.some(id => typeof id !== 'string' || !/^drug-[a-z0-9_-]+$/.test(id))) return false;
    if (!Array.isArray(s.versions) || s.versions.length !== s.ids.length || s.versions.some(v => typeof v !== 'string' || !/^[a-f0-9]{12}$/.test(v))) return false;
    if (!Number.isInteger(s.index) || s.index < 0 || s.index > s.ids.length || !['draft','feedback','result'].includes(s.stage)) return false;
    if ((s.stage === 'result') !== (s.index === s.ids.length)) return false;
    if (typeof s.draft !== 'string' || typeof s.unknown !== 'boolean' || !Array.isArray(s.checked) || !Array.isArray(s.results) || s.results.length !== s.index) return false;
    if (s.results.some(r => !r || !s.ids.includes(r.id) || !Array.isArray(r.missed_elements) || typeof r.remains_review !== 'boolean')) return false;
    return true;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); $('storageNotice').hidden = true; }
    catch { $('storageNotice').hidden = false; }
  }
  function record(q) {
    const rec = state.records[q.id];
    return rec && rec.version === q.version ? rec : null;
  }
  function threshold() { return Number(document.querySelector('input[name="importance"]:checked').value); }
  function inScope() {
    const unit = $('unit').value;
    return BANK.filter(q => q.importance >= threshold() && (
      unit === 'all' || (unit.startsWith('year:') ? q.year === Number(unit.slice(5)) : q.unit_id === unit)
    ));
  }
  function show(name) {
    ['start','quiz','result'].forEach(id => $(id).hidden = id !== name);
    if (name === 'start') updateStart();
    window.scrollTo(0,0);
  }
  function makeOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }
  function populateUnits() {
    const select = $('unit');
    select.append(makeOption('all', `전체 강좌 · ${BANK.length}문제`));
    const units = [...new Map(BANK.map(q => [q.unit_id, {id:q.unit_id,label:q.unit_label,year:q.year}])).values()];
    for (const year of [2026,2025]) {
      const group = document.createElement('optgroup');
      group.label = year === 2025 ? '2025 참고' : '2026 강의록·필기';
      group.append(makeOption(`year:${year}`, `${year === 2025 ? '2025 참고' : '2026 자료'} 전체`));
      for (const unit of units.filter(u => u.year === year).sort((a,b) => a.label.localeCompare(b.label, 'ko', {numeric:true}))) {
        const count = BANK.filter(q => q.unit_id === unit.id).length;
        group.append(makeOption(unit.id, `${unit.label} · ${count}문제`));
      }
      select.append(group);
    }
    select.value = state.settings.unit;
    document.querySelector(`input[name="importance"][value="${state.settings.importance}"]`).checked = true;
  }
  function updateStart() {
    const pool = inScope();
    const reviewed = pool.filter(q => record(q)?.status === 'review');
    $('available').textContent = pool.length;
    $('done').textContent = pool.filter(q => record(q)).length;
    $('reviewCount').textContent = reviewed.length;
    $('startAll').disabled = !pool.length;
    $('startReview').disabled = !reviewed.length;
    $('startAll').textContent = `${Math.min(10,pool.length)}문제 시작`;
    $('startReview').textContent = `다시 볼 약물만 (${reviewed.length})`;
  }
  function shuffle(list) {
    const copy = [...list];
    for (let i=copy.length-1;i>0;i--) {
      const j = Math.floor(Math.random()*(i+1));
      [copy[i],copy[j]]=[copy[j],copy[i]];
    }
    return copy;
  }
  function beginIds(ids) {
    const chosen = shuffle(ids).slice(0,10);
    if (!chosen.length) return;
    state.session = {ids:chosen, versions:chosen.map(id => BY_ID.get(id).version), index:0, stage:'draft', draft:'', unknown:false, checked:[], results:[]};
    save();
    renderQuestion();
  }
  function begin(reviewOnly) {
    const pool = inScope().filter(q => !reviewOnly || record(q)?.status === 'review');
    beginIds(pool.map(q => q.id));
  }
  function current() { return state.session && BY_ID.get(state.session.ids[state.session.index]); }
  function formatOneSource(source) {
    const label = source.year === 2025 ? '2025 참고' : '2026';
    return `${label} · ${source.pdf} · PDF ${source.pages.join(', ')}쪽`;
  }
  function renderQuestion() {
    const s = state.session, q = current();
    if (!q) return;
    show('quiz');
    $('progress').textContent = `${s.index+1} / ${s.ids.length} · 중요도 ${q.importance}점`;
    $('barFill').style.width = `${(s.index + (s.stage === 'feedback' ? 1 : 0))/s.ids.length*100}%`;
    $('questionYear').textContent = q.year === 2025 ? '· 2025 참고' : '';
    $('prompt').textContent = q.drug;
    $('answer').value = s.draft;
    $('answer').disabled = s.stage === 'feedback';
    $('beforeActions').hidden = s.stage === 'feedback';
    $('feedback').hidden = s.stage !== 'feedback';
    if (s.stage === 'feedback') {
      $('savedAnswer').textContent = s.draft || '(적은 답 없음)';
      $('modelAnswer').textContent = q.explanation;
      const sourceEl = $('source');
      sourceEl.replaceChildren(document.createTextNode([formatOneSource(q.source), ...q.supporting_sources.map(formatOneSource)].join(' / ')));
      for (const external of q.external_sources || []) {
        sourceEl.append(document.createTextNode(' / '));
        const link = document.createElement('a');
        link.href = external.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = external.label;
        sourceEl.append(link);
      }
      const list = $('elementList');
      list.replaceChildren();
      q.essential_elements.forEach((element, index) => {
        const label = document.createElement('label');
        label.className = 'element';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.value = String(index); input.checked = s.checked.includes(index); input.disabled = s.unknown || !s.draft;
        input.addEventListener('change', () => { s.checked = [...list.querySelectorAll('input:checked')].map(el => Number(el.value)); save(); });
        const span = document.createElement('span'); span.textContent = element;
        label.append(input,span); list.append(label);
      });
      $('next').focus();
    } else $('answer').focus();
  }
  function reveal(unknown) {
    const s = state.session;
    if (!s || s.stage !== 'draft') return;
    s.draft = unknown ? '' : $('answer').value.trim();
    s.unknown = unknown; s.checked = []; s.stage = 'feedback';
    save(); renderQuestion();
    $('feedback').scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function mark() {
    const s = state.session, q = current();
    if (!s || s.stage !== 'feedback' || !q) return;
    const checked = s.unknown || !s.draft ? [] : s.checked;
    const missed = q.essential_elements.filter((_,i) => !checked.includes(i));
    const before = record(q), day = today();
    state.records[q.id] = window.DrugReviewPolicy.nextRecord(before, q.version, missed, day);
    const remain = state.records[q.id].status === 'review';
    s.results.push({id:q.id, missed_elements:missed, remains_review:remain});
    s.index++;
    if (s.index === s.ids.length) s.stage = 'result';
    else {s.stage='draft';s.draft='';s.unknown=false;s.checked=[];}
    save();
    if (s.stage === 'result') renderResult(); else renderQuestion();
  }
  function renderResult() {
    const results = state.session.results;
    const missed = results.filter(r => r.missed_elements.length);
    const review = results.filter(r => r.remains_review);
    $('resultTotal').textContent = results.length;
    $('resultRemembered').textContent = results.length - missed.length;
    $('resultMissed').textContent = missed.length;
    const list = $('missedList'); list.replaceChildren();
    if (!review.length) {
      const li = document.createElement('li'); li.textContent = '이번 연습에서 다시 볼 약물이 없습니다.'; list.append(li);
    }
    for (const item of review) {
      const q = BY_ID.get(item.id), li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('span');
      title.textContent = q.drug;
      detail.textContent = item.missed_elements.length ? item.missed_elements.join(' ') : '오늘 다시 확인했습니다. 다음 날 이후 한 번 더 맞히면 복습 목록에서 해제됩니다.';
      li.append(title,detail); list.append(li);
    }
    $('retry').disabled = !review.length;
    show('result');
    $('again').focus();
  }
  function download(data, prefix) {
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${prefix}-${today()}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup(prefix='drug-memory-backup') {
    download({format:'drug-memory-backup',schema_version:1,exported_at:new Date().toISOString(),state},prefix);
  }
  async function importBackup(file) {
    try {
      if (!file || file.size > 5_000_000) throw new Error('파일이 없거나 너무 큽니다.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'drug-memory-backup' || data.schema_version !== 1 || !validState(data.state)) throw new Error('지원하지 않거나 손상된 백업 파일입니다.');
      exportBackup('drug-memory-before-restore');
      state = data.state;
      if (!sessionMatchesBank(state.session)) state.session = null;
      if (!unitExists(state.settings.unit)) state.settings.unit = 'all';
      save();
      $('unit').value = state.settings.unit;
      document.querySelector(`input[name="importance"][value="${state.settings.importance}"]`).checked = true;
      $('backupNotice').textContent = '기존 기록을 백업한 뒤 가져온 기록으로 복원했습니다.';
      if (state.session?.stage === 'result') renderResult();
      else if (state.session) renderQuestion();
      else show('start');
    } catch (error) { $('backupNotice').textContent = `복원하지 못했습니다: ${error.message}`; }
    finally { $('import').value = ''; }
  }

  populateUnits();
  $('classificationCount').textContent = window.QUESTION_BANK_META?.classification_only ?? '–';
  $('unit').addEventListener('change', () => {state.settings.unit=$('unit').value;save();updateStart();});
  document.querySelectorAll('input[name="importance"]').forEach(input => input.addEventListener('change', () => {state.settings.importance=threshold();save();updateStart();}));
  $('startAll').addEventListener('click', () => begin(false));
  $('startReview').addEventListener('click', () => begin(true));
  $('answer').addEventListener('input', () => {if (state.session?.stage === 'draft') {state.session.draft=$('answer').value;save();}});
  $('reveal').addEventListener('click', () => reveal(false));
  $('unknown').addEventListener('click', () => reveal(true));
  $('next').addEventListener('click', mark);
  $('retry').addEventListener('click', () => beginIds(state.session.results.filter(r => r.remains_review).map(r => r.id)));
  $('again').addEventListener('click', () => {state.session=null;save();show('start');});
  $('quit').addEventListener('click', () => {state.session=null;save();show('start');});
  $('export').addEventListener('click', () => exportBackup());
  $('import').addEventListener('change', event => importBackup(event.target.files[0]));
  if (state.session?.stage === 'result') renderResult();
  else if (state.session) renderQuestion();
  else show('start');
})();
