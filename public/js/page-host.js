// Host page: template download, spreadsheet parsing + validation preview, room creation.
import { initI18n, t, onLangChange } from './i18n.js';
import { $, el, show, toast } from './ui.js';
import { mountMuteButton, sfx } from './fx.js';
import { readSpreadsheetFile, templateCsvBlob, templateXlsxBlob, downloadBlob } from './spreadsheet.js';
import { matrixToRows, validateRows } from './shared/quiz-validate.js';
import { rooms, errorMessage } from './api.js';
import { startStage, loadHostToken } from './host-stage.js';

// The dictionary is awaited *after* the file input is wired up, not before.
// A module script runs before `load`, but this one had a top-level `await` in
// front of every `addEventListener`, so on a cold start (first hit of the dev
// worker, slow disk, big dictionary) the window between the page being
// interactive and the listener existing was hundreds of milliseconds long - and
// a `change` event that lands in that window is gone for good: the file sits in
// the input, nothing parses it, and the page just sits there. That is a real
// bug for a presenter who picks a file the instant the page paints, and it is
// what makes the upload-validation e2e test hang for its full timeout instead
// of failing fast.
const i18nReady = initI18n();

let parsed = null; // { rows, result }
let chosenFile = null;

/** The file input paints nothing of its own, so its label says what was picked. */
function paintFileName(file) {
  chosenFile = file || null;
  const node = $('#file-name');
  if (node) node.textContent = chosenFile ? t('host.file_chosen', { name: chosenFile.name }) : t('host.file_none');
}
onLangChange(() => paintFileName(chosenFile));

$('#file').addEventListener('change', async (e) => {
  await i18nReady;
  const file = e.target.files && e.target.files[0];
  paintFileName(file);
  if (!file) { parsed = null; renderValidation(); return; }
  try {
    const matrix = await readSpreadsheetFile(file);
    const headerInfo = matrixToRows(matrix);
    // headerInfo is passed so an unrecognized header row is reported as such
    // instead of silently turning into "the question text is required".
    parsed = { rows: headerInfo.rows, headerInfo, result: null };
    revalidate();
  } catch (err) {
    parsed = null;
    toast(err.i18nKey ? t(err.i18nKey) : t('err.file_read'), 'error');
  }
  renderValidation();
});

await i18nReady;
mountMuteButton($('#mute'), () => t('common.mute_toggle'));

/**
 * The setup rail. It is a map of where the host is, not a decoration: steps
 * before `current` read as done, `current` reads as active, the rest stay
 * neutral. Nothing here claims progress the host has not actually made.
 */
function setStep(current) {
  document.querySelectorAll('#setup-steps .step').forEach((node) => {
    const n = Number(node.dataset.step);
    node.classList.toggle('done', n < current);
    node.classList.toggle('now', n === current);
  });
}

$('#dl-csv').addEventListener('click', () => {
  downloadBlob(templateCsvBlob(), 'livepoll-template.csv');
  setStep(2);
  sfx.click();
});
$('#dl-xlsx').addEventListener('click', () => {
  downloadBlob(templateXlsxBlob(), 'livepoll-template.xlsx');
  setStep(2);
  sfx.click();
});

/**
 * Re-runs the validator with the current language, so the fallback block name
 * of a row that left the `block` column empty is localized (P2-8) - it used to
 * be a hardcoded "Block 1" showing up as "Bloco: Block 1" in a pt panel.
 */
function revalidate() {
  if (!parsed) return;
  parsed.result = validateRows(parsed.rows, parsed.headerInfo, { defaultBlockName: t('panel.default_block') });
}

function renderValidation() {
  const box = $('#validation');
  const preview = $('#preview');
  box.innerHTML = '';
  preview.innerHTML = '';
  if (!parsed) {
    box.appendChild(el('p', { class: 'hint', text: t('host.no_file') }));
    return;
  }
  const { result } = parsed;
  if (result.ok) {
    box.appendChild(el('p', { class: 'pill pill-ok', text: `✅ ${t('valid.ok')} — ${t('host.preview_questions', { count: result.questions.length })} ${t('host.preview_blocks', { count: result.blocks.length })}` }));
  } else {
    box.appendChild(el('p', { class: 'pill pill-bad', text: `⚠️ ${t('valid.errors_found', { count: result.errors.length })}` }));
    const list = el('ul', { class: 'errors' });
    result.errors.forEach((err) => {
      const where = err.line ? `${t('valid.line', { line: err.line })} · ${t(`field.${err.field}`)}` : t(`field.${err.field}`);
      list.appendChild(el('li', { text: `${where}: ${t(err.code, err.params)}` }));
    });
    box.appendChild(list);
  }
  // Non-fatal notices: values the server would clamp anyway (P2-8).
  const warnings = result.warnings || [];
  if (warnings.length) {
    box.appendChild(el('p', { class: 'pill pill-warn', text: `ℹ️ ${t('valid.warnings_found', { count: warnings.length })}` }));
    const list = el('ul', { class: 'warnings' });
    warnings.forEach((w) => {
      const where = w.line ? `${t('valid.line', { line: w.line })} · ${t(`field.${w.field}`)}` : t(`field.${w.field}`);
      list.appendChild(el('li', { text: `${where}: ${t(w.code, w.params)}` }));
    });
    box.appendChild(list);
  }

  const badLines = new Set(result.errors.map((e) => e.line));
  const table = el('table', { class: 'preview-table' });
  const head = el('tr');
  [t('field.block'), t('field.type'), t('field.question'), t('field.option1'), t('field.correct'), t('field.time_limit'), t('field.points')]
    .forEach((label) => head.appendChild(el('th', { text: label })));
  table.appendChild(el('thead', {}, head));
  const body = el('tbody');
  result.questions.forEach((q) => {
    const correct = q.type === 'open_text'
      ? q.answerKey.join(' | ')
      : q.options.map((o, i) => (o.correct ? String(i + 1) : null)).filter(Boolean).join(', ');
    const row = el('tr', { class: badLines.has(q.line) ? 'bad' : '' });
    [
      q.block || t('panel.default_block'),
      t(`type.${q.type}`),
      q.prompt,
      q.options.map((o, i) => `${i + 1}. ${o.text}`).join(' / '),
      correct,
      `${q.timeLimit}s`,
      String(q.points),
    ].forEach((value, column) => row.appendChild(el('td', {}, column === 1
      ? el('span', { class: 'tag', text: value })
      : value)));
    body.appendChild(row);
  });
  table.appendChild(body);
  preview.appendChild(el('h3', { text: t('host.preview_title') }));
  preview.appendChild(table);
  setStep(result.ok ? 3 : 2);
}
renderValidation();
onLangChange(() => { revalidate(); renderValidation(); });

$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#password').value;
  if (!parsed || !parsed.result.ok) {
    toast(t(parsed ? 'valid.errors_found' : 'host.no_file', { count: parsed ? parsed.result.errors.length : 0 }), 'error');
    return;
  }
  if (password.length < 4) {
    toast(t('err.bad_password_length'), 'error');
    return;
  }
  const btn = $('#create-btn');
  btn.disabled = true;
  btn.textContent = t('host.creating');
  try {
    const quiz = {
      title: $('#title').value.trim() || t('app.name'),
      blocks: parsed.result.blocks.map((b) => ({ name: b.name, questions: b.questions })),
    };
    const res = await rooms.create(password, quiz, { showPromptOnPhone: $('#show-prompt').checked });
    sfx.join();
    history.replaceState(null, '', `?code=${res.code}`);
    startStage(res.code, res.hostToken);
  } catch (err) {
    toast(errorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('host.create_btn');
  }
});

$('#reopen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#r-code').value.trim().toUpperCase();
  try {
    const res = await rooms.hostLogin(code, $('#r-password').value);
    startStage(code, res.hostToken);
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
});

// Reopen automatically when we already hold a host token for ?code=
const params = new URLSearchParams(location.search);
const codeParam = (params.get('code') || '').toUpperCase();
if (codeParam) {
  const token = loadHostToken(codeParam);
  if (token) startStage(codeParam, token);
  else $('#r-code').value = codeParam;
}
if (location.hash === '#reopen') $('#r-code').focus();
