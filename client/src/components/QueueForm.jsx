import { useState } from 'react';

/** Create / edit form for a queue. */
export default function QueueForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [prefix, setPrefix] = useState(initial?.prefix ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError('Give the queue a name');
    setBusy(true);
    setError('');
    try {
      await onSubmit({ name, prefix, description });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="queue-form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Queue name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="e.g. Billing desk" />
      </label>
      <div className="queue-form-row">
        <label className="field">
          <span>Token prefix</span>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            maxLength={4}
            placeholder="Auto"
          />
          <small>Tokens look like {(prefix || autoPrefix(name) || 'Q') + '-001'}</small>
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Shown under the queue name" />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function autoPrefix(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, '')[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 3);
}
