// Landing page: language switcher, join shortcut.
import { initI18n, t } from './i18n.js';
import { $, toast } from './ui.js';
import { mountMuteButton, sfx } from './fx.js';

await initI18n();
mountMuteButton($('#mute'), () => t('common.mute_toggle'));

const params = new URLSearchParams(location.search);
if (params.get('code')) $('#code').value = params.get('code').toUpperCase();

$('#code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#code').value.trim().toUpperCase();
  const nickname = $('#nickname').value.trim();
  if (code.length !== 6) {
    toast(t('err.ROOM_NOT_FOUND'), 'error');
    $('#code').focus();
    return;
  }
  sfx.click();
  const q = new URLSearchParams({ code });
  if (nickname) q.set('nickname', nickname);
  location.href = `/play.html?${q}`;
});
