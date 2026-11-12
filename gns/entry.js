import { installGnsFetch } from './install-fetch.js';

async function boot() {
  await window.gns?.ready?.();
  installGnsFetch();
  await import('../public/app.js');
}

boot().catch((error) => {
  const el = document.getElementById('session-status');
  if (el) {
    el.hidden = false;
    el.textContent = error?.message || String(error);
  } else {
    console.error(error);
  }
});
