// LivePoll Worker: JSON API under /api plus a /j/:code join shortcut.
// Static assets are served by the [assets] binding.
import { json, errorResponse, fail } from './lib/http.js';
import { createRoom, hostLogin, joinRoom, leaderboard } from './routes/rooms.js';
import { getState, submitAnswer, sendReaction } from './routes/play.js';
import { hostAction, hostAnswers, hostGrade, hostQuiz, hostSettings } from './routes/host.js';
import { normalizeRoomCode } from './lib/codes.js';

// Primary graph walkers plus the explicit steps the stage keyboard binds.
const HOST_ACTIONS = ['start', 'advance', 'back', 'options', 'reveal', 'leaderboard', 'next', 'end'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      // QR / short join link -> player page
      const joinMatch = path.match(/^\/j\/([A-Za-z0-9]{1,12})$/);
      if (joinMatch) {
        return Response.redirect(`${url.origin}/play.html?code=${normalizeRoomCode(joinMatch[1])}`, 302);
      }
      if (!path.startsWith('/api')) {
        if (env.ASSETS && env.ASSETS.fetch) return env.ASSETS.fetch(request);
        return new Response('Not found', { status: 404 });
      }
      return await route(request, env, url, path);
    } catch (e) {
      return errorResponse(e);
    }
  },
};

async function route(request, env, url, path) {
  const method = request.method.toUpperCase();
  const segments = path.split('/').filter(Boolean); // ['api', 'rooms', code, ...]

  if (path === '/api/health') return json({ ok: true, now: Date.now() });

  if (segments[1] !== 'rooms') fail('NOT_FOUND', `No route for ${path}`);

  if (segments.length === 2) {
    if (method === 'POST') return createRoom(request, env);
    fail('NOT_FOUND', `No route for ${method} ${path}`);
  }

  const code = normalizeRoomCode(segments[2]);
  const rest = segments.slice(3);

  if (rest.length === 1) {
    const [action] = rest;
    if (method === 'POST' && action === 'host-login') return hostLogin(request, env, code);
    if (method === 'POST' && action === 'join') return joinRoom(request, env, code);
    if (method === 'POST' && action === 'answer') return submitAnswer(request, env, code);
    if (method === 'POST' && action === 'reaction') return sendReaction(request, env, code);
    if (method === 'GET' && action === 'state') return getState(request, env, code, url);
    if (method === 'GET' && action === 'leaderboard') return leaderboard(request, env, code, url);
  }

  if (rest.length === 2 && rest[0] === 'host') {
    const action = rest[1];
    if (method === 'GET' && action === 'answers') return hostAnswers(request, env, code, url);
    if (method === 'GET' && action === 'quiz') return hostQuiz(request, env, code);
    if (method === 'POST' && action === 'grade') return hostGrade(request, env, code);
    if (method === 'POST' && action === 'settings') return hostSettings(request, env, code);
    if (method === 'POST' && HOST_ACTIONS.includes(action)) return hostAction(request, env, code, action);
  }

  return fail('NOT_FOUND', `No route for ${method} ${path}`);
}
