// Вход при запуске (§7): пароль проверяет сервер; без связи — сохранённая проверка, не дольше 7 дней.
const $ = id => document.getElementById(id);
window.erpShell.loginInfo().then(i => { $('who').textContent = `${i.name} · ${i.email} · сервер ${i.serverUrl}`; });
function show(r) {
  $('error').textContent = r.message || 'Не удалось войти';
  $('error').hidden = false;
  // Устройство отозвано: неотправленные данные можно сохранить в файл (пароль сверяется с сохранённой проверкой).
  if (r.canExport) $('export').hidden = false;
}
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  $('submit').disabled = true; $('submit').textContent = 'Проверяем…'; $('error').hidden = true;
  const r = await window.erpShell.unlock($('login-password').value);
  if (!r.ok) show(r);
  $('submit').disabled = false; $('submit').textContent = 'Войти';
});
$('export').addEventListener('click', async () => {
  const r = await window.erpShell.exportQueue($('login-password').value);
  $('note').textContent = r.ok ? `Сохранено: ${r.file}` : (r.message || 'Не сохранено');
  $('note').hidden = false;
});
