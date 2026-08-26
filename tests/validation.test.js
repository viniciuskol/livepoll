import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matrixToRows, validateRows, validateQuiz, canonicalHeader, canonicalType,
  parseCorrectIndexes, slug, MAX_QUESTIONS, headerErrors,
} from '../src/worker/lib/validation.js';

const HEADER = ['block', 'type', 'question', 'option1', 'option2', 'option3', 'option4', 'correct', 'time_limit', 'points'];
const rowsOf = (...rows) => matrixToRows([HEADER, ...rows]).rows;

test('headers are matched case/accent insensitively in EN, PT and ES', () => {
  assert.equal(canonicalHeader('Block'), 'block');
  assert.equal(canonicalHeader('BLOCO'), 'block');
  assert.equal(canonicalHeader('Bloque'), 'block');
  assert.equal(canonicalHeader('Pergunta'), 'question');
  assert.equal(canonicalHeader('Pregunta'), 'question');
  assert.equal(canonicalHeader('Tempo limite'), 'time_limit');
  assert.equal(canonicalHeader('Opção 3'), 'option3');
  assert.equal(canonicalHeader('opcion4'), 'option4');
  assert.equal(canonicalHeader('Explicación'), 'explanation');
  assert.equal(canonicalHeader('unknown col'), null);
  assert.equal(slug('Tempo Limite'), 'tempo_limite');
});

test('question types accept aliases in three languages', () => {
  assert.equal(canonicalType('multiple_choice'), 'multiple_choice');
  assert.equal(canonicalType('Escolha Multipla'), 'multiple_choice');
  assert.equal(canonicalType('opcion_multiple'), 'multiple_choice');
  assert.equal(canonicalType('MS'), 'multiple_select');
  assert.equal(canonicalType('seleccion multiple'), 'multiple_select');
  assert.equal(canonicalType('verdadeiro_falso'), 'true_false');
  assert.equal(canonicalType('VF'), 'true_false');
  assert.equal(canonicalType('aberta'), 'open_text');
  assert.equal(canonicalType('nonsense'), null);
});

test('correct column accepts indexes, letters and separators', () => {
  assert.deepEqual(parseCorrectIndexes('2', 4, 'multiple_choice').indexes, [2]);
  assert.deepEqual(parseCorrectIndexes('B', 4, 'multiple_choice').indexes, [2]);
  assert.deepEqual(parseCorrectIndexes('1,3;4', 4, 'multiple_select').indexes, [1, 3, 4]);
  assert.deepEqual(parseCorrectIndexes('a; c', 4, 'multiple_select').indexes, [1, 3]);
  assert.deepEqual(parseCorrectIndexes('verdadeiro', 2, 'true_false').indexes, [1]);
  assert.deepEqual(parseCorrectIndexes('false', 2, 'true_false').indexes, [2]);
  const bad = parseCorrectIndexes('9,Z', 4, 'multiple_choice');
  assert.deepEqual(bad.indexes, []);
  assert.deepEqual(bad.bad, ['9', 'Z']);
});

test('matrixToRows skips blank lines and tracks the source line number', () => {
  const { rows } = matrixToRows([[], HEADER, ['', '', '', '', '', '', '', '', '', ''], ['B', 'mc', 'Q', 'a', 'b', '', '', '1', '', '']]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].__line, 4);
  assert.equal(rows[0].question, 'Q');
});

test('a valid sheet produces blocks in first-seen order', () => {
  const rows = rowsOf(
    ['Intro', 'mc', 'Q1', 'a', 'b', '', '', '2', '20', '1000'],
    ['Deep', 'vf', 'Q2', '', '', '', '', 'true', '15', '800'],
    ['Intro', 'aberta', 'Q3', '', '', '', '', 'x|y', '30', '1000'],
  );
  const res = validateRows(rows);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual(res.blocks.map((b) => b.name), ['Intro', 'Deep']);
  assert.equal(res.blocks[0].questions.length, 2);
  assert.equal(res.questions[0].options[1].correct, true);
  assert.deepEqual(res.questions[1].options.map((o) => [o.text, o.correct]), [['true', true], ['false', false]]);
  assert.deepEqual(res.questions[2].answerKey, ['x', 'y']);
});

test('missing block name falls back to Block 1', () => {
  const res = validateRows(rowsOf(['', 'mc', 'Q', 'a', 'b', '', '', '1', '', '']));
  assert.equal(res.ok, true);
  assert.equal(res.blocks[0].name, 'Block 1');
  assert.equal(res.questions[0].timeLimit, 20);
  assert.equal(res.questions[0].points, 1000);
});

test('per-row errors report line, field and i18n code', () => {
  const res = validateRows(rowsOf(
    ['B', 'mc', '', 'a', 'b', '', '', '1', '', ''],
    ['B', 'mc', 'Q', 'a', '', '', '', '1', '', ''],
    ['B', 'mc', 'Q', 'a', 'b', '', '', '', '', ''],
    ['B', 'mc', 'Q', 'a', 'b', 'c', '', '1,2', '', ''],
    ['B', 'mc', 'Q', 'a', 'b', '', '', '9', '', ''],
    ['B', 'bogus', 'Q', 'a', 'b', '', '', '1', '', ''],
    ['B', 'mc', 'Q', 'a', 'b', '', '', '1', '2', ''],
    ['B', 'mc', 'Q', 'a', 'b', '', '', '1', '', '99999'],
    ['B', 'vf', 'Q', '', '', '', '', 'maybe', '', ''],
    ['B', 'mc', 'Q', 'a', '', 'c', '', '1', '', ''],
  ));
  assert.equal(res.ok, false);
  const byLine = new Map();
  res.errors.forEach((e) => byLine.set(e.line, [...(byLine.get(e.line) || []), e.code]));
  const has = (line, code) => assert.ok(byLine.get(line).includes(code), `line ${line}: ${byLine.get(line)}`);
  has(2, 'err.missing_question');
  has(3, 'err.too_few_options');
  has(4, 'err.missing_correct');
  has(5, 'err.too_many_correct');
  has(6, 'err.invalid_correct');
  has(7, 'err.invalid_type');
  has(10, 'err.invalid_true_false');
  has(11, 'err.options_gap');
  res.errors.forEach((e) => assert.ok(e.field && e.code.startsWith('err.')));
  // Out-of-range time limits / points are clamped by the server, so the client
  // reports them as non-fatal warnings instead of refusing the sheet (P2-8).
  const warnByLine = new Map();
  res.warnings.forEach((w) => warnByLine.set(w.line, [...(warnByLine.get(w.line) || []), w.code]));
  assert.deepEqual(warnByLine.get(8), ['warn.time_limit_clamped']);
  assert.deepEqual(warnByLine.get(9), ['warn.points_clamped']);
  assert.ok(!res.errors.some((e) => e.line === 8 || e.line === 9));
});

test('out-of-range time limit and points are clamped with a warning', () => {
  const res = validateRows(rowsOf(
    ['B', 'mc', 'Q', 'a', 'b', '', '', '1', '2', '99999'],
    ['B', 'mc', 'Q2', 'a', 'b', '', '', '1', 'abc', ''],
  ));
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.questions[0].timeLimit, 5);
  assert.equal(res.questions[0].points, 10000);
  assert.equal(res.questions[1].timeLimit, 20, 'unparsable falls back to the default');
  assert.equal(res.warnings.length, 3);
  assert.ok(res.warnings.every((w) => w.code.startsWith('warn.')));
});

test('an unrecognized header row is a fatal, self-explaining error', () => {
  const info = matrixToRows([['foo', 'bar', 'baz'], ['x', 'y', 'z']]);
  const res = validateRows(info.rows, info);
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1, JSON.stringify(res.errors));
  assert.equal(res.errors[0].code, 'err.missing_headers');
  assert.match(res.errors[0].params.expected, /question/);
  // Without the question column the sheet is equally unusable.
  const noQuestion = matrixToRows([['block', 'type', 'correct'], ['B', 'mc', '1']]);
  const res2 = validateRows(noQuestion.rows, noQuestion);
  assert.equal(res2.ok, false);
  assert.ok(res2.errors.some((e) => e.code === 'err.missing_headers'));
  // A good header row produces no header-level error.
  const good = matrixToRows([HEADER, ['B', 'mc', 'Q', 'a', 'b', '', '', '1', '', '']]);
  assert.deepEqual(headerErrors(good.rawHeaders), []);
  assert.equal(validateRows(good.rows, good).ok, true);
});

test('option7 and beyond is reported instead of silently dropped', () => {
  const header = ['question', 'option1', 'option2', 'option7', 'opcao8', 'correct'];
  const info = matrixToRows([header, ['Q', 'a', 'b', 'c', 'd', '1']]);
  const res = validateRows(info.rows, info);
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].code, 'err.too_many_options');
  assert.equal(res.errors[0].params.max, 6);
  assert.match(res.errors[0].params.value, /option7/);
  assert.match(res.errors[0].params.value, /opcao8/);
});

test('an empty sheet is rejected', () => {
  const res = validateRows([]);
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].code, 'err.no_rows');
});

test('type is inferred when the column is missing', () => {
  const { rows } = matrixToRows([['question', 'option1', 'option2', 'correct'], ['Q', 'a', 'b', '1'], ['Q2', '', '', 'yes']]);
  const res = validateRows(rows);
  assert.equal(res.questions[0].type, 'multiple_choice');
  assert.equal(res.questions[1].type, 'open_text');
});

test('validateQuiz re-checks a payload server side', () => {
  const good = {
    title: 'T',
    blocks: [{ name: 'B', questions: [
      { type: 'multiple_choice', prompt: 'Q', timeLimit: 20, points: 1000, options: [{ text: 'a', correct: true }, { text: 'b' }] },
      { type: 'open_text', prompt: 'Q2', answerKey: ['x'], options: [] },
    ] }],
  };
  const res = validateQuiz(good);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.quiz.blocks[0].questions.length, 2);

  assert.equal(validateQuiz(null).ok, false);
  assert.equal(validateQuiz({ blocks: [] }).ok, false);
  const noCorrect = validateQuiz({ blocks: [{ name: 'B', questions: [{ type: 'multiple_choice', prompt: 'Q', options: [{ text: 'a' }, { text: 'b' }] }] }] });
  assert.equal(noCorrect.ok, false);
  assert.equal(noCorrect.errors[0].code, 'err.missing_correct');
  const twoCorrect = validateQuiz({ blocks: [{ name: 'B', questions: [{ type: 'true_false', prompt: 'Q', options: [{ text: 'true', correct: true }, { text: 'false', correct: true }] }] }] });
  assert.equal(twoCorrect.errors[0].code, 'err.too_many_correct');
});

test('validateQuiz clamps out-of-range time limits and points', () => {
  const res = validateQuiz({ blocks: [{ name: 'B', questions: [
    { type: 'multiple_choice', prompt: 'Q', timeLimit: 5000, points: -20, options: [{ text: 'a', correct: true }, { text: 'b' }] },
  ] }] });
  assert.equal(res.ok, true);
  assert.equal(res.quiz.blocks[0].questions[0].timeLimit, 300);
  assert.equal(res.quiz.blocks[0].questions[0].points, 0);
});

test('too many questions is rejected', () => {
  const questions = Array.from({ length: MAX_QUESTIONS + 1 }, () => ({
    type: 'multiple_choice', prompt: 'Q', options: [{ text: 'a', correct: true }, { text: 'b' }],
  }));
  const res = validateQuiz({ blocks: [{ name: 'B', questions }] });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === 'err.too_many_rows'));
});
