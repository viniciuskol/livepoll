// Server-side re-export of the shared spreadsheet/quiz validation (SPEC §3).
export {
  validateQuiz,
  validateRows,
  DEFAULT_BLOCK_NAME,
  matrixToRows,
  headerErrors,
  EXPECTED_HEADERS,
  canonicalType,
  canonicalHeader,
  parseCorrectIndexes,
  slug,
  QUESTION_TYPES,
  MAX_OPTIONS,
  MIN_OPTIONS,
  DEFAULT_POINTS,
  DEFAULT_TIME_LIMIT,
  MAX_QUESTIONS,
} from '../../../public/js/shared/quiz-validate.js';
