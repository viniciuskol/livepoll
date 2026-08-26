// Shared spreadsheet -> quiz validation (SPEC §3).
// Pure ESM, no DOM and no Worker APIs: used by the browser, the Worker and the unit tests.

export const QUESTION_TYPES = ['multiple_choice', 'multiple_select', 'true_false', 'open_text'];
export const MAX_OPTIONS = 6;
export const MIN_OPTIONS = 2;
export const DEFAULT_TIME_LIMIT = 20;
export const DEFAULT_POINTS = 1000;
export const MAX_QUESTIONS = 200;
export const LETTERS = 'ABCDEF';

/** Accent/case-insensitive key for header + enum matching. */
export function slug(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const HEADER_ALIASES = {
  block: ['block', 'bloco', 'bloque', 'grupo', 'group'],
  type: ['type', 'tipo'],
  question: ['question', 'pergunta', 'pregunta', 'enunciado'],
  correct: ['correct', 'correta', 'correto', 'correcta', 'corretas', 'resposta', 'respostas', 'respuesta', 'respuestas', 'answer', 'answers', 'gabarito'],
  time_limit: ['time_limit', 'timelimit', 'time', 'tempo', 'tempo_limite', 'limite_tempo', 'tiempo', 'tiempo_limite', 'segundos', 'seconds'],
  points: ['points', 'pontos', 'pontuacao', 'puntos', 'puntaje', 'score'],
  image_url: ['image_url', 'image', 'imagem', 'imagen', 'url_imagem', 'url_imagen', 'imageurl'],
  explanation: ['explanation', 'explicacao', 'explicacion', 'explicación', 'justificativa', 'feedback'],
};

const OPTION_PREFIXES = ['option', 'opcao', 'opcion', 'alternativa', 'resposta_opcao', 'op'];

/** Human-readable list of the canonical headers, used in error messages. */
export const EXPECTED_HEADERS = 'block, type, question, option1..option6, correct, time_limit, points, image_url, explanation';

const TYPE_ALIASES = {
  multiple_choice: ['multiple_choice', 'multiplechoice', 'mc', 'escolha_multipla', 'multipla_escolha', 'opcion_multiple', 'multiple', 'unica', 'single', 'quiz'],
  multiple_select: ['multiple_select', 'multipleselect', 'ms', 'multipla_selecao', 'selecao_multipla', 'seleccion_multiple', 'multi', 'varias', 'checkbox'],
  true_false: ['true_false', 'truefalse', 'tf', 'vf', 'verdadeiro_falso', 'verdadero_falso', 'v_f', 'boolean', 'bool'],
  open_text: ['open_text', 'opentext', 'open', 'aberta', 'texto_aberto', 'abierta', 'texto_libre', 'text', 'texto', 'livre'],
};

const TRUE_WORDS = ['true', 't', 'v', 'verdadeiro', 'verdadero', 'sim', 'si', 'yes', 'y', '1'];
const FALSE_WORDS = ['false', 'f', 'falso', 'nao', 'no', 'n', '2'];

/** Canonical question type from a raw cell value, or null. */
export function canonicalType(raw) {
  const s = slug(raw);
  if (!s) return null;
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
    if (type === s || aliases.includes(s)) return type;
  }
  return null;
}

/** Maps a header cell to a canonical field name, or null when unknown. */
export function canonicalHeader(raw) {
  const s = slug(raw);
  if (!s) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(s)) return field;
  }
  for (const prefix of OPTION_PREFIXES) {
    const m = s.match(new RegExp(`^${prefix}_?([1-9])$`));
    if (m && Number(m[1]) <= MAX_OPTIONS) return `option${m[1]}`;
  }
  return null;
}

/** Converts a matrix (first non-empty row = header) into row objects. */
export function matrixToRows(matrix) {
  const rows = (matrix || []).map((r) => (Array.isArray(r) ? r : []));
  const headerIndex = rows.findIndex((r) => r.some((c) => String(c || '').trim() !== ''));
  if (headerIndex < 0) return { headers: [], rawHeaders: [], rows: [] };
  const rawHeaders = rows[headerIndex].map((c) => String(c == null ? '' : c).trim());
  const headers = rawHeaders.map(canonicalHeader);
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw.some((c) => String(c == null ? '' : c).trim() !== '')) continue;
    const obj = { __line: i + 1 };
    headers.forEach((h, col) => {
      if (!h) return;
      obj[h] = String(raw[col] == null ? '' : raw[col]).trim();
    });
    out.push(obj);
  }
  return { headers, rawHeaders, rows: out };
}

/**
 * Fatal problems with the header row itself. Without this a sheet whose headers
 * are all unknown would silently lose every column (and only complain that the
 * question text is missing).
 */
export function headerErrors(rawHeaders) {
  const list = (rawHeaders || []).map((h) => String(h == null ? '' : h).trim());
  const canonical = list.map(canonicalHeader).filter(Boolean);
  const errors = [];
  if (!list.length || !canonical.length) {
    return [err(1, 'quiz', 'err.missing_headers', { expected: EXPECTED_HEADERS })];
  }
  if (!canonical.includes('question')) {
    errors.push(err(1, 'question', 'err.missing_headers', { expected: EXPECTED_HEADERS }));
  }
  const extraOptions = list.filter((h) => {
    const m = slug(h).match(/^(?:option|opcao|opcion|alternativa|resposta_opcao|op)_?([0-9]+)$/);
    return !!m && Number(m[1]) > MAX_OPTIONS;
  });
  if (extraOptions.length) {
    errors.push(err(1, 'option1', 'err.too_many_options', { max: MAX_OPTIONS, value: extraOptions.join(', ') }));
  }
  return errors;
}

function parseCorrectTokens(raw) {
  return String(raw == null ? '' : raw)
    .split(/[,;\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses a `correct` cell into 1-based option indexes. */
export function parseCorrectIndexes(raw, optionCount, type) {
  const tokens = parseCorrectTokens(raw);
  const idx = [];
  const bad = [];
  for (const tok of tokens) {
    const s = slug(tok);
    if (type === 'true_false') {
      if (TRUE_WORDS.includes(s)) { idx.push(1); continue; }
      if (FALSE_WORDS.includes(s)) { idx.push(2); continue; }
      bad.push(tok);
      continue;
    }
    if (/^[0-9]+$/.test(s)) {
      const n = Number(s);
      if (n >= 1 && n <= optionCount) idx.push(n);
      else bad.push(tok);
      continue;
    }
    if (s.length === 1 && LETTERS.includes(s.toUpperCase())) {
      const n = LETTERS.indexOf(s.toUpperCase()) + 1;
      if (n <= optionCount) idx.push(n);
      else bad.push(tok);
      continue;
    }
    bad.push(tok);
  }
  return { indexes: [...new Set(idx)].sort((a, b) => a - b), bad };
}

function intOr(raw, fallback) {
  const s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (s === '') return { value: fallback, provided: false, valid: true };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: fallback, provided: true, valid: false };
  return { value: Math.round(n), provided: true, valid: true };
}

function err(line, field, code, params) {
  return { line, field, code, params: params || {} };
}

function clampToRange(raw, fallback, min, max) {
  const parsed = intOr(raw, fallback);
  const wanted = parsed.valid ? parsed.value : fallback;
  const value = Math.min(max, Math.max(min, wanted));
  return { value, adjusted: !parsed.valid || value !== wanted, raw };
}

/**
 * Validates spreadsheet rows and builds the quiz payload.
 * @param {Array<object>} rows row objects from matrixToRows
 * @returns {{ok:boolean, errors:Array, questions:Array, blocks:Array}}
 */
/**
 * Fallback block name for rows that leave the `block` column empty. The
 * validator runs in the browser *and* in the Worker, so it cannot call the i18n
 * runtime: the caller passes the already-translated name and this constant is
 * only the last resort (P2-8).
 */
export const DEFAULT_BLOCK_NAME = 'Block 1';

export function validateRows(rows, headerInfo, opts = {}) {
  const errors = [];
  const warnings = [];
  const questions = [];
  const list = Array.isArray(rows) ? rows : [];

  // A broken header row makes every per-row message meaningless, so it is
  // reported on its own.
  if (headerInfo && headerInfo.rawHeaders) {
    const headerProblems = headerErrors(headerInfo.rawHeaders);
    if (headerProblems.length) {
      return { ok: false, errors: headerProblems, warnings, questions: [], blocks: [] };
    }
  }

  if (list.length === 0) errors.push(err(0, 'question', 'err.no_rows'));
  if (list.length > MAX_QUESTIONS) errors.push(err(0, 'question', 'err.too_many_rows', { max: MAX_QUESTIONS }));

  list.forEach((row, i) => {
    const line = row.__line || i + 2;
    const prompt = String(row.question || '').trim();
    const rawOptions = [];
    for (let n = 1; n <= MAX_OPTIONS; n++) {
      const v = String(row[`option${n}`] == null ? '' : row[`option${n}`]).trim();
      rawOptions.push(v);
    }
    const filled = rawOptions.filter((v) => v !== '');

    let type = canonicalType(row.type);
    if (!type) {
      if (String(row.type || '').trim() !== '') {
        errors.push(err(line, 'type', 'err.invalid_type', { value: row.type }));
        return;
      }
      type = filled.length >= MIN_OPTIONS ? 'multiple_choice' : 'open_text';
    }

    if (!prompt) errors.push(err(line, 'question', 'err.missing_question'));

    // The server clamps these silently, so the client warns instead of
    // refusing the whole sheet (P2-8: one behaviour on both sides).
    const time = clampToRange(row.time_limit, DEFAULT_TIME_LIMIT, 5, 300);
    if (time.adjusted) {
      warnings.push(err(line, 'time_limit', 'warn.time_limit_clamped', {
        value: String(row.time_limit == null ? '' : row.time_limit), clamped: time.value, min: 5, max: 300,
      }));
    }
    const points = clampToRange(row.points, DEFAULT_POINTS, 0, 10000);
    if (points.adjusted) {
      warnings.push(err(line, 'points', 'warn.points_clamped', {
        value: String(row.points == null ? '' : row.points), clamped: points.value, min: 0, max: 10000,
      }));
    }

    const question = {
      type,
      prompt,
      timeLimit: time.value,
      points: points.value,
      imageUrl: String(row.image_url || '').trim() || null,
      explanation: String(row.explanation || '').trim() || null,
      block: String(row.block || '').trim(),
      options: [],
      answerKey: [],
      line,
    };

    if (type === 'open_text') {
      question.answerKey = String(row.correct || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (type === 'true_false') {
      question.options = [
        { text: 'true', correct: false },
        { text: 'false', correct: false },
      ];
      const { indexes, bad } = parseCorrectIndexes(row.correct, 2, 'true_false');
      if (bad.length || indexes.length !== 1) {
        errors.push(err(line, 'correct', 'err.invalid_true_false', { value: row.correct }));
      } else {
        question.options[indexes[0] - 1].correct = true;
      }
    } else {
      if (filled.length < MIN_OPTIONS) {
        errors.push(err(line, 'option1', 'err.too_few_options', { min: MIN_OPTIONS, count: filled.length }));
      }
      // Options must be contiguous from option1.
      const firstEmpty = rawOptions.findIndex((v) => v === '');
      if (firstEmpty >= 0 && rawOptions.slice(firstEmpty).some((v) => v !== '')) {
        errors.push(err(line, 'option1', 'err.options_gap'));
      }
      question.options = filled.map((text) => ({ text, correct: false }));
      const { indexes, bad } = parseCorrectIndexes(row.correct, filled.length, type);
      if (bad.length) {
        errors.push(err(line, 'correct', 'err.invalid_correct', { value: bad.join(', '), max: filled.length }));
      }
      if (indexes.length === 0) {
        errors.push(err(line, 'correct', 'err.missing_correct'));
      } else if (type === 'multiple_choice' && indexes.length > 1) {
        errors.push(err(line, 'correct', 'err.too_many_correct', { count: indexes.length }));
      }
      indexes.forEach((n) => {
        if (question.options[n - 1]) question.options[n - 1].correct = true;
      });
    }

    questions.push(question);
  });

  // Group into blocks, preserving first-seen order.
  const blocks = [];
  const byName = new Map();
  questions.forEach((q) => {
    const name = q.block || String(opts.defaultBlockName || DEFAULT_BLOCK_NAME);
    if (!byName.has(name)) {
      const b = { name, questions: [] };
      byName.set(name, b);
      blocks.push(b);
    }
    byName.get(name).questions.push(q);
  });

  return { ok: errors.length === 0, errors, warnings, questions, blocks };
}

/** Server-side validation of an already-built quiz payload. */
export function validateQuiz(quiz) {
  const errors = [];
  if (!quiz || typeof quiz !== 'object') return { ok: false, errors: [err(0, 'quiz', 'err.invalid_quiz')], quiz: null };
  const blocks = Array.isArray(quiz.blocks) ? quiz.blocks : [];
  if (blocks.length === 0) errors.push(err(0, 'quiz', 'err.no_rows'));
  let count = 0;
  const clean = [];
  blocks.forEach((b, bi) => {
    const name = String((b && b.name) || `Block ${bi + 1}`).slice(0, 120);
    const qs = Array.isArray(b && b.questions) ? b.questions : [];
    const outQs = [];
    qs.forEach((q, qi) => {
      count += 1;
      const line = Number(q && q.line) || count + 1;
      const type = QUESTION_TYPES.includes(q && q.type) ? q.type : null;
      if (!type) { errors.push(err(line, 'type', 'err.invalid_type', { value: q && q.type })); return; }
      const prompt = String((q && q.prompt) || '').trim();
      if (!prompt) { errors.push(err(line, 'question', 'err.missing_question')); return; }
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => ({ text: String((o && o.text) || '').trim(), correct: !!(o && o.correct) }))
        .filter((o) => o.text !== '')
        .slice(0, MAX_OPTIONS);
      const answerKey = (Array.isArray(q.answerKey) ? q.answerKey : []).map((s) => String(s).trim()).filter(Boolean);
      if (type === 'open_text') {
        if (options.length) options.length = 0;
      } else {
        if (options.length < MIN_OPTIONS) { errors.push(err(line, 'option1', 'err.too_few_options', { min: MIN_OPTIONS, count: options.length })); return; }
        const corr = options.filter((o) => o.correct).length;
        if (corr === 0) { errors.push(err(line, 'correct', 'err.missing_correct')); return; }
        if (type !== 'multiple_select' && corr > 1) { errors.push(err(line, 'correct', 'err.too_many_correct', { count: corr })); return; }
      }
      const timeLimit = clampInt(q.timeLimit, 5, 300, DEFAULT_TIME_LIMIT);
      const points = clampInt(q.points, 0, 10000, DEFAULT_POINTS);
      outQs.push({
        type,
        prompt: prompt.slice(0, 500),
        timeLimit,
        points,
        imageUrl: q.imageUrl ? String(q.imageUrl).slice(0, 500) : null,
        explanation: q.explanation ? String(q.explanation).slice(0, 1000) : null,
        options,
        answerKey,
      });
    });
    if (outQs.length) clean.push({ name, questions: outQs });
  });
  if (count > MAX_QUESTIONS) errors.push(err(0, 'question', 'err.too_many_rows', { max: MAX_QUESTIONS }));
  if (count === 0) errors.push(err(0, 'quiz', 'err.no_rows'));
  return {
    ok: errors.length === 0,
    errors,
    quiz: { title: String((quiz.title || '')).slice(0, 200), blocks: clean },
  };
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
