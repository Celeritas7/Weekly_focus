/* Integration checks: use actual rendered controls, not private app functions. */
window.addEventListener('load', async function () {
  var passed = 0;
  function report(message) { parent.postMessage({type:'wf-details-test',message:message},new URL(document.baseURI).origin); }
  function assert(ok, message) { if (!ok) throw Error(message); passed++; }
  function find(selector) { var el=document.querySelector(selector); if(!el)throw Error('Missing '+selector);return el; }
  function click(selector) { find(selector).click(); }
  function type(selector,value) { var el=find(selector);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true})); }
  function tick(selector) { var el=find(selector);el.checked=!el.checked;el.dispatchEvent(new Event('change',{bubbles:true})); }
  function turn() { return new Promise(resolve=>setTimeout(resolve,30)); }
  function close(action) { return new Promise(resolve => { var dialog=find('dialog[open]');dialog.addEventListener('close',resolve,{once:true});if(action)click(action);else dialog.close(); }); }
  function submitGoal(name) { type('.wf-goal-create input',name);find('.wf-goal-create').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); }
  try {
    await turn();
    click('.sd-slot[data-sdk="app:detail-test"]');
    assert(document.querySelectorAll('#sdInfoCard [data-sd="gset"]').length===1,'Sphere has one goal button');
    assert(!document.querySelector('#sdInfoCard [data-sd="gtog"]'),'Sphere hides goal choices');
    assert(document.querySelectorAll('#sdInfoCard [data-selected-goal]').length===1 && find('#sdInfoCard [data-selected-goal="g4"]').textContent==='Basic needs','Sphere shows only the selected goal outside the picker');
    click('#sdInfoCard [data-sd="gset"]');
    assert(find('dialog[open]').getBoundingClientRect().top<30,'Picker opens near top');
    assert(find('.wf-goal-option input[data-goal="g4"]').checked,'Existing goal remains selected');
    await close();
    click('#sdInfoCard [data-sd="card"]');
    assert(document.querySelectorAll('#bsBody button.goal-chip').length===1,'Full card has one goal button');
    assert(find('#bsBody button.goal-chip').textContent==='+ New goal','Button says + New goal');
    assert(document.querySelectorAll('#bsBody [data-selected-goal]').length===1 && find('#bsBody [data-selected-goal="g4"]').textContent==='Basic needs','Full card shows only the selected goal outside the picker');
    click('#bsBody [data-act="goalpick"]');
    assert(document.querySelectorAll('.wf-goal-option').length===14,'Picker shows all goals on demand');
    type('.wf-goal-search input','language');
    assert(document.querySelectorAll('.wf-goal-option').length===1,'Search filters goals');
    tick('.wf-goal-option input[data-goal="g3"]');
    assert(find('.wf-goal-option input').checked,'Goal selection remains visible after search');
    click('[data-lead="g3"]');
    assert(find('[data-lead="g3"]').getAttribute('aria-pressed')==='true','Lead assignment works');
    tick('.wf-goal-option input[data-goal="g3"]');
    tick('.wf-goal-option input[data-goal="g3"]');
    assert(find('[data-lead="g3"]').getAttribute('aria-pressed')==='false','Unlink clears lead assignment');
    submitGoal('New improvement goal');
    assert(document.querySelectorAll('.wf-goal-option').length===15,'Create adds a goal');
    assert(document.querySelectorAll('.wf-goal-option input:checked').length===3,'New goal is linked');
    submitGoal('Basic needs');
    assert(document.querySelectorAll('.wf-goal-option').length===15,'Duplicate name does not create a duplicate');
    assert(find('.wf-goal-option input[data-goal="g4"]').checked,'Duplicate creation keeps existing goal linked');
    await close();
    assert(find('#buildSheet').classList.contains('open'),'Closing picker keeps the app card open');
    assert(document.querySelectorAll('#bsBody [data-selected-goal]').length===3,'New selections appear outside the closed picker');
    click('#bsBody [data-act="goalpick"]');
    assert(document.querySelectorAll('.wf-goal-option input:checked').length===3,'Selections survive closing and reopening');
    var chosen=[...document.querySelectorAll('.wf-goal-option input:checked')].map(el=>el.dataset.goal);
    chosen.forEach(id=>tick('.wf-goal-option input[data-goal="'+id+'"]'));
    await close();
    assert(!document.querySelector('#bsBody [data-selected-goal]') && find('#bsBody [data-act="goalpick"]'),'Clearing goals hides badges but keeps the picker button');
    click('#bsBody [data-act="goalpick"]');
    chosen.forEach(id=>tick('.wf-goal-option input[data-goal="'+id+'"]'));
    tick('.wf-goal-option input[data-goal="g13"]');
    await close();
    var longGoal=find('#bsBody [data-selected-goal="g13"]').getBoundingClientRect(),goalRow=find('#bsBody .goal-row').getBoundingClientRect();
    assert(longGoal.width<=goalRow.width+1 && longGoal.right<=goalRow.right+1,'Long selected goal wraps within the card');
    click('#bsBody [data-act="goalpick"]');
    tick('.wf-goal-option input[data-goal="g13"]');
    await close();
    var row=find('#bsBody [data-sid="sub-b"]'), text=row.querySelector('.sub-text-editable').getBoundingClientRect(), tools=row.querySelector('.sub-tools').getBoundingClientRect();
    assert(tools.top>=text.bottom-1,'Checklist tools sit below the comment');
    assert(text.width>row.getBoundingClientRect().width*.65,'Comment has most of the row width');
    assert(find('#bsBody .notes').getBoundingClientRect().height>=150,'Notes start with a roomy writing area');
    click('#bsBody [data-sid="sub-b"] [data-act="subedit-start"]');
    var dialog=find('dialog[open]').getBoundingClientRect(), editor=find('.wf-writer-input').getBoundingClientRect(), footer=find('.wf-detail-foot').getBoundingClientRect();
    assert(editor.width>dialog.width*.8,'Writer uses the available width');
    assert(editor.height>200,'Writer provides a tall text area');
    assert(footer.bottom<=innerHeight+1,'Save controls fit inside the viewport');
    assert(find('.wf-writer-input').selectionStart===find('.wf-writer-input').value.length,'Editing places the caret at the end');
    var comment='改善案を追加します。\nKeep the context and line breaks.\nမြန်မာစာ';
    type('.wf-writer-input',comment);
    await close('.wf-writer-actions .wf-detail-primary');
    assert(find('#bsBody [data-sid="sub-b"] .sub-text-editable').textContent===comment,'Multiline Unicode comment saves intact');
    click('#bsBody [data-sid="sub-b"] [data-act="subedit-start"]');
    type('.wf-writer-input','Discard this edit');await close('.wf-writer-actions .wf-detail-secondary');
    assert(find('#bsBody [data-sid="sub-b"] .sub-text-editable').textContent===comment,'Cancel preserves the saved comment');
    click('#bsBody [data-act="notesexpand"]');type('.wf-writer-input','Longer app notes\nWith a second line.');await close('.wf-writer-actions .wf-detail-primary');
    assert(find('#bsBody .notes').value==='Longer app notes\nWith a second line.','Expanded notes save back into the card');
    type('#bsBody .notes','Inline notes also save.');
    find('#bsBody .notes').blur();click('#bsBody [data-act="goalpick"]');await close();
    assert(find('#bsBody .notes').value==='Inline notes also save.','Inline notes survive a card redraw');
    type('#bsBody .sub-new','New checklist item\nWith details');click('#bsBody [data-act="subadd"]');await turn();
    assert([...document.querySelectorAll('#bsBody .sub-text-editable')].some(el=>el.textContent==='New checklist item\nWith details'),'New multiline item is added');
    // Leave the full card open for human visual / keyboard checks.
    report('PASS · '+passed+' checks');
  } catch(error) { report('FAIL after '+passed+' checks: '+error.message); }
});
