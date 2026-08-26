// Fetch wrapper for the LivePoll JSON API.
import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details || [];
  }
}

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || (data && data.error)) {
    const err = (data && data.error) || {};
    throw new ApiError(err.code || 'INTERNAL', err.message, err.details);
  }
  return data;
}

/** Human-readable, translated message for an API error. */
export function errorMessage(e) {
  if (e instanceof ApiError) {
    const detail = Array.isArray(e.details) && e.details.length ? e.details[0] : null;
    if (detail && detail.code) return t(detail.code, detail.params || detail);
    return t(`err.${e.code}`);
  }
  if (e && e.name === 'AbortError') return '';
  return t('err.generic');
}

export const rooms = {
  create: (password, quiz, settings = {}) =>
    api('/rooms', { method: 'POST', body: { password, quiz, showPromptOnPhone: !!settings.showPromptOnPhone } }),
  hostLogin: (code, password) => api(`/rooms/${code}/host-login`, { method: 'POST', body: { password } }),
  join: (code, nickname) => api(`/rooms/${code}/join`, { method: 'POST', body: { nickname } }),
  // `hostToken` identifies the stage, which is the only audience allowed to
  // read the prompt while the room is in `reading`.
  state: (code, since, playerToken, signal, hostToken) => {
    const q = new URLSearchParams();
    if (since != null) q.set('since', String(since));
    if (playerToken) q.set('playerToken', playerToken);
    return api(`/rooms/${code}/state?${q}`, { signal, token: hostToken });
  },
  answer: (code, payload) => api(`/rooms/${code}/answer`, { method: 'POST', body: payload }),
  reaction: (code, playerToken, emoji) => api(`/rooms/${code}/reaction`, { method: 'POST', body: { playerToken, emoji } }),
  leaderboard: (code, playerToken) => api(`/rooms/${code}/leaderboard${playerToken ? `?playerToken=${playerToken}` : ''}`),
  // `guard` carries {from} (and optionally {version}): the state the caller
  // believes the room is in, so a duplicate click is rejected server side.
  hostAction: (code, action, token, guard = {}) =>
    api(`/rooms/${code}/host/${action}`, { method: 'POST', token, body: guard }),
  hostSettings: (code, token, settings) => api(`/rooms/${code}/host/settings`, { method: 'POST', token, body: settings }),
  hostQuiz: (code, token) => api(`/rooms/${code}/host/quiz`, { token }),
  hostAnswers: (code, token, questionId) => api(`/rooms/${code}/host/answers?questionId=${questionId}`, { token }),
  hostGrade: (code, token, questionId, groups) => api(`/rooms/${code}/host/grade`, { method: 'POST', token, body: { questionId, groups } }),
};
