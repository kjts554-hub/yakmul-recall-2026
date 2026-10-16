(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const data = window.RECALL_APP_DATA;
  const {selectRecords, PilotSession} = window.RecallPilotCore;
  const Progress = window.RecallProgress;
  const records = data.records;
  const units = data.units;
  const unitIds = units.map(unit => unit.id);
  let storage = null;
  try { storage = window.localStorage; } catch {}
  let progressState = Progress.read(storage,unitIds);
  let settings = {...progressState.settings,unitIds:[...progressState.settings.unitIds]};
  let draft = null;
  let session = null;
  let sessionSettings = null;
  let sessionRecords = null;
  let composing = false;
  const importanceText = n => ({3:'3점만',2:'2점 이상',1:'전체 중요도'})[n];
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function screen(name) {
    for (const id of ['start','question','result']) $(id+'Screen').hidden = id !== name;
    window.scrollTo({top:0,behavior:'instant'});
  }
  function pool(options=settings) { return selectRecords(records, options); }
  function scopeText(ids) {
    const selected=units.filter(unit => ids.includes(unit.id));
    if (selected.length===units.length) return `전체 ${units.length}개 단원`;
    if (!selected.length) return '선택한 단원 없음';
    if (selected.length<=2) return selected.map(unit => unit.label).join(', ');
    return `${selected[0].label} 외 ${selected.length-1}개 단원`;
  }
  function saveProgress() { $('storageNotice').hidden=Progress.write(storage,progressState); }
  function saveSettings() {
    progressState={...progressState,settings:{...settings,unitIds:[...settings.unitIds]}};
    saveProgress();
  }
  function updateStart(focus=false) {
    const available = pool();
    const history = Progress.stats(progressState,settings.mode,available);
    const fieldsMode = settings.mode === 'fields';
    $('startTitle').replaceChildren(...(fieldsMode ? ['항목별로 떠올리고,','빈칸을 채워보세요.'] : ['특징을 보고,','약물 이름을 떠올려보세요.']).flatMap((line,i) => i ? [document.createElement('br'),document.createTextNode(line)] : [document.createTextNode(line)]));
    $('modeDescription').textContent = fieldsMode ? '약물 이름을 보고 표적·기전·용도를 각각 적어봅니다.' : '확인된 특징을 읽고 영어 약물명을 적으면 자동으로 채점합니다.';
    $('scopeLabel').textContent = scopeText(settings.unitIds);
    $('scopeMeta').textContent = `${importanceText(settings.minImportance)} · ${fieldsMode?'항목별 회상':'이름 맞히기'}`;
    $('availableCount').textContent = available.length;
    $('availabilityNote').textContent = !available.length ? '선택한 단원·중요도에 출제할 문제가 없습니다. 범위나 문제 방식을 바꿔주세요.' : fieldsMode ? '확인된 내용이 있는 항목만 빈칸으로 나옵니다.' : '단서만으로 약물 이름을 하나로 특정할 수 있는 문제만 출제합니다.';
    $('learningProgress').textContent=`이 범위에서 확인 ${history.seen} / ${available.length}개 · 다시 볼 약물 ${history.review}개`;
    $('begin').textContent = available.length ? `${available.length}개 약물 시작` : '출제할 약물이 없어요';
    $('begin').disabled = !available.length;
    $('beginReview').textContent=`다시 볼 ${history.review}개 약물만 연습`;
    $('beginReview').disabled=!history.review;
    const legacyCount=Object.keys(progressState.legacy?.records || {}).length;
    $('legacyNotice').hidden=!legacyCount;
    $('legacyNotice').textContent=`이전 문제 방식의 기록 ${legacyCount}개를 별도로 보관하고 백업에 포함합니다. 새 문제 방식의 진행률에는 합산하지 않습니다.`;
    if (focus) $('startTitle').focus();
  }
  function home() {
    session = null;
    composing = false;
    screen('start');
    updateStart(true);
  }
  function updateModal() {
    draft.unitIds = [...$('unitList').querySelectorAll('input:checked')].map(input => input.value);
    draft.minImportance = Number(document.querySelector('input[name="importance"]:checked').value);
    const count = pool(draft).length;
    for (const unit of units) {
      const row=$('unitList').querySelector(`input[value="${unit.id}"]`).closest('label');
      const unitCount=pool({...draft,unitIds:[unit.id]}).length;
      row.querySelector('small').textContent=`${unitCount}개`;
      row.classList.toggle('empty-unit',!unitCount);
    }
    $('selectedUnitCount').textContent=`${draft.unitIds.length}개 선택`;
    $('modalCount').textContent = draft.unitIds.length ? `${draft.unitIds.length}개 단원 · ${importanceText(draft.minImportance)} · ${count}개 약물` : '단원을 하나 이상 선택하세요.';
    $('applyScope').disabled = !draft.unitIds.length;
  }
  function renderUnits() {
    $('unitList').replaceChildren();
    for (const unit of units) {
      const row=make('label','unit-row');
      const input=make('input');input.type='checkbox';input.value=unit.id;input.checked=draft.unitIds.includes(unit.id);
      input.addEventListener('change',updateModal);
      row.append(input,make('span','',unit.label),make('small'));
      $('unitList').append(row);
    }
  }
  function openScope() {
    draft = {...settings,unitIds:[...settings.unitIds]};
    renderUnits();
    document.querySelector(`input[name="importance"][value="${draft.minImportance}"]`).checked = true;
    updateModal();
    $('scopeDialog').showModal();
  }
  function closeScope() { $('scopeDialog').close(); }
  function begin(selectedRecords=records, options=settings) {
    if (!selectRecords(selectedRecords,options).length) return;
    sessionSettings = {...options,unitIds:[...options.unitIds]};
    sessionRecords = selectedRecords;
    session = new PilotSession(selectedRecords,options);
    composing = false;
    renderQuestion();
  }
  function createFields(question, feedback) {
    const container = $('fieldInputs');
    container.replaceChildren();
    question.fields.forEach((field,index) => {
      const card = make('div','field-card');
      const label = make('label','field-label');
      label.htmlFor = 'field-'+field.id;
      label.append(make('span','field-number',String(index+1).padStart(2,'0')),document.createTextNode(field.label));
      const input = make('textarea');
      input.id = 'field-'+field.id;
      input.dataset.fieldId = field.id;
      input.rows = 2;
      input.maxLength = 3000;
      input.placeholder = field.label+'을 적어보세요';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = feedback?.values[field.id] || '';
      input.readOnly = !!feedback;
      card.append(label);
      if (feedback) card.append(make('p','answer-caption',input.value ? '내 답' : '내 답 · 작성하지 않음'));
      card.append(input);
      if (feedback) {
        const model = make('div','model-response');
        model.append(make('span','small-label','정답'),make('p','',field.answer));
        const checkLabel = make('label','self-check');
        const check = make('input');
        check.type = 'checkbox';
        check.dataset.checkField = field.id;
        check.checked = feedback.rememberedIds.includes(field.id);
        check.disabled = feedback.unknown || !input.value.trim();
        check.addEventListener('change',() => session.markField(field.id,check.checked));
        checkLabel.append(check,document.createTextNode(check.disabled ? '다시 볼 항목이에요' : '내 답에 핵심이 담겼어요'));
        model.append(checkLabel);
        card.append(model);
      }
      container.append(card);
    });
  }
  function renderNameFeedback(question, feedback) {
    const container = $('nameFeedback');
    container.replaceChildren(make('span','small-label','정답'),make('p','correct-name',question.name));
    const aliases = question.reverse.acceptedAnswers.filter(a => a !== question.name);
    if (aliases.length) container.append(make('p','helper','인정하는 다른 표기: '+aliases.join(' · ')));
    const dl = make('dl');
    for (const field of question.fields) dl.append(make('dt','',field.label),make('dd','',field.answer));
    container.append(dl);
  }
  function renderQuestion() {
    const question = session.current;
    const feedback = session.feedback;
    const fieldsMode = session.mode === 'fields';
    screen('question');
    const progress = Math.round(session.index/session.total*100);
    $('progressText').textContent = `${session.index+1} / ${session.total}`;
    $('progressBar').setAttribute('aria-valuenow',String(progress));
    $('progressFill').style.width = progress+'%';
    $('questionUnit').textContent = `${question.unitLabel} · ${question.importance}점${question.sourceYears?.includes(2025)?' · 2025 참고 포함':''}`;
    $('questionMode').textContent = fieldsMode ? '약물명 → 항목별 회상' : '특징 → 이름 맞히기';
    $('questionTitle').textContent = fieldsMode ? question.name : '이 약물의 이름은?';
    $('questionHelp').textContent = fieldsMode ? (feedback ? '내 답과 정답을 비교하고, 기억한 항목을 체크하세요.' : '각 항목에 기억나는 내용을 적어보세요. 모르는 항목은 비워도 됩니다.') : '영어 일반명 또는 인정된 동의어를 입력하세요.';
    $('nameClue').hidden = fieldsMode;
    $('nameClue').textContent = fieldsMode ? '' : question.reverse.prompt;
    $('fieldInputs').hidden = !fieldsMode;
    if (fieldsMode) createFields(question,feedback);
    else $('fieldInputs').replaceChildren();
    $('nameAnswer').hidden = fieldsMode;
    $('drugName').value = feedback?.name || '';
    $('drugName').readOnly = !!feedback;
    $('beforeActions').hidden = !!feedback;
    $('afterActions').hidden = !feedback;
    $('feedbackMessage').hidden = !feedback;
    $('answerError').hidden = true;
    $('nameFeedback').hidden = fieldsMode || !feedback;
    $('nameFeedback').replaceChildren();
    $('correctionInfo').hidden = !feedback || !question.correctionNote;
    $('correctionText').textContent = feedback ? question.correctionNote || '' : '';
    $('correctionInfo').open = false;
    if (feedback) {
      const message = fieldsMode ? (feedback.unknown ? '이번 약물의 모든 항목을 다시 볼 내용으로 남깁니다.' : '기억한 항목만 체크해주세요.') : (feedback.unknown ? '모르는 약물로 기록했어요. 정답을 확인해보세요.' : feedback.correct ? '정답이에요.' : '다시 확인해보세요.');
      $('feedbackMessage').textContent = message;
      $('feedbackMessage').classList.toggle('wrong',feedback.unknown || (!fieldsMode && !feedback.correct));
      if (!fieldsMode) renderNameFeedback(question,feedback);
      $('assessmentHelp').textContent = fieldsMode ? '체크하지 않은 항목과 비워 둔 항목이 다시 볼 내용에 남습니다. 문장 답안은 직접 비교해 판단합니다.' : '대소문자·공백·하이픈은 구분하지 않습니다. 다른 철자와 숫자는 그대로 구분합니다.';
      $('next').textContent = session.index+1 === session.total ? '결과 보기' : '확인하고 다음';
      $('feedbackMessage').focus();
    } else {
      $('reveal').textContent = fieldsMode ? '답 확인' : '제출하고 채점';
      if (fieldsMode) $('questionTitle').focus();
      else $('drugName').focus();
    }
  }
  function reveal(unknown=false) {
    if (!session || session.stage !== 'question' || composing) return;
    const values = Object.fromEntries([...$('fieldInputs').querySelectorAll('textarea')].map(input => [input.dataset.fieldId,input.value]));
    const name = $('drugName').value;
    if (!unknown && (session.mode === 'name' ? !name.trim() : !Object.values(values).some(v => v.trim()))) {
      $('answerError').textContent = session.mode === 'name' ? '약물 이름을 적거나 ‘모르겠어요’를 선택해주세요.' : '한 항목 이상 적거나 ‘모르겠어요’를 선택해주세요.';
      $('answerError').hidden = false;
      (session.mode === 'name' ? $('drugName') : $('fieldInputs').querySelector('textarea')).focus();
      return;
    }
    if (session.reveal({values,name,unknown})) renderQuestion();
  }
  function renderResult() {
    screen('result');
    const summary = session.summary();
    const fieldsMode = session.mode === 'fields';
    $('resultScope').textContent = `${scopeText(sessionSettings.unitIds)} · ${importanceText(sessionSettings.minImportance)} · ${fieldsMode?'항목별 회상':'이름 맞히기'}`;
    $('resultTotal').textContent = summary.total;
    $('resultCorrect').textContent = summary.correct;
    $('resultMissed').textContent = summary.missed.length;
    $('correctLabel').textContent = fieldsMode ? '모든 항목 기억' : '정답';
    $('fieldSummary').hidden = !fieldsMode;
    $('fieldGaps').replaceChildren();
    const gaps = summary.fieldTotals.filter(f => f.remembered < f.total);
    if (gaps.length) for (const gap of gaps) {
      const chip = make('span','gap-chip',gap.label);
      chip.append(make('b','',`${gap.total-gap.remembered}개`));
      $('fieldGaps').append(chip);
    } else $('fieldGaps').append(make('p','helper','이번 연습의 모든 항목을 확인했어요.'));
    $('missedList').replaceChildren();
    for (const result of summary.missed) {
      const details = make('details');
      const title = make('summary');
      title.append(make('strong','',result.name),make('small','',result.unitLabel+' · '+(fieldsMode ? result.missingFields.map(f => f.label).join(' · ') : '입력: '+(result.submittedName || '모르겠어요'))));
      const body = make('div','missed-detail');
      const dl = make('dl');
      if (fieldsMode) for (const field of result.missingFields) dl.append(make('dt','',field.label),make('dd','',field.answer));
      else dl.append(make('dt','','정답'),make('dd','',result.name));
      body.append(dl);
      details.append(title,body);
      $('missedList').append(details);
    }
    if (!summary.missed.length) $('missedList').append(make('p','helper','다시 볼 약물이 없어요.'));
    $('retryMissed').disabled = !summary.missed.length;
    $('retryMissed').textContent = `다시 볼 ${summary.missed.length}개 약물 연습`;
    $('resultNote').textContent = fieldsMode ? '항목별 회상 결과는 직접 체크한 내용입니다. 다시 풀 때도 약물 순서는 무작위입니다.' : '이름 맞히기 결과는 등록된 일반명·동의어와 대조한 자동채점 결과입니다.';
    $('resultTitle').focus();
  }
  function downloadBackup(prefix='drug-recall-backup') {
    const blob=new Blob([JSON.stringify(Progress.makeBackup(progressState),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),anchor=make('a');
    anchor.href=url;anchor.download=`${prefix}-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importBackup(file) {
    try {
      if(!file || file.size>5_000_000)throw new Error('백업 파일이 없거나 너무 큽니다.');
      const restored=Progress.restoreBackup(JSON.parse(await file.text()),unitIds,progressState);
      downloadBackup('drug-recall-before-restore');
      progressState=restored.state;
      settings={...progressState.settings,unitIds:[...progressState.settings.unitIds]};
      saveProgress();
      document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked=true;
      home();
      $('backupNotice').textContent=restored.kind==='legacy'?'이전 방식의 기록을 별도로 보관했습니다. 현재 방식의 학습 결과는 유지합니다.':'기존 기록을 백업한 뒤 가져온 기록으로 복원했습니다.';
    } catch {
      $('backupNotice').textContent='가져오지 못했습니다. 올바른 백업 파일인지 확인해주세요. 파일은 5MB 이하여야 합니다.';
    } finally {$('importBackup').value='';}
  }
  document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change',() => {settings.mode=input.value;saveSettings();updateStart();}));
  $('openScope').addEventListener('click',openScope);
  for (const id of ['closeScope','cancelScope']) $(id).addEventListener('click',closeScope);
  $('selectAllUnits').addEventListener('click',()=>{$('unitList').querySelectorAll('input').forEach(input=>{input.checked=true;});updateModal();});
  $('clearUnits').addEventListener('click',()=>{$('unitList').querySelectorAll('input').forEach(input=>{input.checked=false;});updateModal();});
  document.querySelectorAll('input[name="importance"]').forEach(input => input.addEventListener('change',updateModal));
  $('applyScope').addEventListener('click',() => {
    if (!draft || !draft.unitIds.length) return;
    settings = {...draft,unitIds:[...draft.unitIds]};
    saveSettings();closeScope();updateStart();
  });
  $('scopeDialog').addEventListener('close',() => {draft=null;$('openScope').focus();});
  $('begin').addEventListener('click',() => begin());
  $('beginReview').addEventListener('click',()=>begin(pool().filter(question=>Progress.getRecord(progressState,settings.mode,question)?.correct===false)));
  $('goHome').addEventListener('click',home);
  $('resultHome').addEventListener('click',home);
  $('answerForm').addEventListener('compositionstart',() => {composing=true;});
  $('answerForm').addEventListener('compositionend',() => {composing=false;});
  $('answerForm').addEventListener('submit',event => {event.preventDefault();reveal();});
  $('drugName').addEventListener('keydown',event => {if(event.key==='Enter' && (event.isComposing || composing)) event.preventDefault();});
  $('unknown').addEventListener('click',() => reveal(true));
  $('next').addEventListener('click',() => {
    const question=session?.current;
    if(session?.advance()){
      progressState=Progress.recordResult(progressState,session.mode,question,session.results.at(-1));saveProgress();
      if(session.stage==='result')renderResult();else renderQuestion();
    }
  });
  $('retryMissed').addEventListener('click',() => {
    const ids=new Set(session.summary().missed.map(r => r.id));
    begin(sessionRecords.filter(r => ids.has(r.id)),sessionSettings);
  });
  $('retryAll').addEventListener('click',() => begin(records,sessionSettings));
  $('exportBackup').addEventListener('click',()=>downloadBackup());
  $('importBackup').addEventListener('change',event=>importBackup(event.target.files[0]));
  document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked=true;
  $('storageNotice').hidden=!!storage;
  updateStart();
})();
