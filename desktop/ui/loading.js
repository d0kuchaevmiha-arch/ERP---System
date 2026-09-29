// Экран загрузки: показывает шаги запуска, которые присылает main-процесс.
window.erpShell.onStatus(text => { document.getElementById('status').textContent = text; });
