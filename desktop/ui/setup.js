// Первый запуск: регистрация устройства на сервере организации (§6.1). Пароль уходит только на сервер и не сохраняется.
const $ = id => document.getElementById(id);
window.erpShell.setupDefaults().then(d => { $('server').value = d.serverUrl; $('device').value = d.deviceName; });
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  $('submit').disabled = true; $('submit').textContent = 'Подключаем…'; $('error').hidden = true;
  const r = await window.erpShell.register({ serverUrl: $('server').value, email: $('email').value, password: $('password').value, deviceName: $('device').value });
  if (!r.ok) {
    $('error').textContent = r.message || 'Не удалось подключиться';
    $('error').hidden = false;
    $('submit').disabled = false; $('submit').textContent = 'Подключить';
  }
});
