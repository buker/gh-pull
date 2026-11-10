const $ = id => document.getElementById(id);

export function createSettingsUi({ apiFetch, onSaved }) {
  const dialog = $('settings-dialog');
  const open = $('settings-open');
  const form = $('settings-form');
  const error = $('settings-error');
  let current = null;

  async function load() {
    const response = await apiFetch('/api/settings');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load settings.');
    current = data.settings;
    $('settings-list-page-size').value = String(current.listPageSize);
    $('settings-field-profile').value = current.fieldProfile;
    error.hidden = true;
  }

  open.addEventListener('click', async () => {
    try {
      await load();
      dialog.showModal();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      dialog.showModal();
    }
  });

  dialog.addEventListener('close', () => { error.hidden = true; });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const listPageSize = Number($('settings-list-page-size').value);
    const fieldProfile = $('settings-field-profile').value;
    try {
      const response = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listPageSize, fieldProfile }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save settings.');
      current = data.settings;
      dialog.close();
      onSaved?.(current);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}
