import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Modal, { ConfirmModal } from '../components/Modal.jsx';
import QueueForm from '../components/QueueForm.jsx';
import { TicketStub } from '../components/Ticket.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatMinutes, formatTime, minutesSince } from '../format.js';
import { useNow, usePolling } from '../hooks.js';

const Arrow = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICON = {
  top: 'M4 3h8M8 13V6M5 9l3-3 3 3',
  up: 'M8 13V3M4.5 6.5 8 3l3.5 3.5',
  down: 'M8 3v10M4.5 9.5 8 13l3.5-3.5',
  x: 'M4 4l8 8M12 4l-8 8',
};

export default function QueuePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const { refreshQueues } = useOutletContext();
  const now = useNow(15000);

  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pending, setPending] = useState(null); // key of the action in flight
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const d = await api(`/queues/${id}`);
      if (seq === requestSeq.current) {
        setData(d);
        setLoadError(null);
      }
    } catch (err) {
      if (seq === requestSeq.current) setLoadError(err);
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    setLoadError(null);
    load();
  }, [load]);
  usePolling(load, 5000);

  /** Run a mutation; the response is the fresh queue detail. */
  async function act(key, path, body, successMsg) {
    if (pending) return null;
    setPending(key);
    requestSeq.current++; // ignore any poll that started before this mutation
    try {
      const d = await api(path, { method: 'POST', body });
      if (d?.queue) setData({ queue: d.queue, waiting: d.waiting, serving: d.serving, history: d.history });
      else await load();
      if (successMsg) notify(typeof successMsg === 'function' ? successMsg(d) : successMsg, 'success');
      refreshQueues();
      return d;
    } catch (err) {
      notify(err.message, 'error');
      load();
      return null;
    } finally {
      setPending(null);
    }
  }

  if (loadError?.status === 404) {
    return (
      <div className="page">
        <div className="panel empty">
          <h2>This queue doesn’t exist any more</h2>
          <p>It may have been deleted.</p>
          <Link className="btn btn-primary" to="/">
            Back to queues
          </Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        <div className="panel empty">{loadError ? loadError.message : 'Loading queue…'}</div>
      </div>
    );
  }

  const { queue, waiting, serving, history } = data;
  const next = waiting[0];

  async function confirmCancel() {
    const ok = await act('cancel', `/tokens/${cancelTarget.id}/cancel`, { reason: cancelReason }, `${cancelTarget.code} cancelled`);
    if (ok) {
      setCancelTarget(null);
      setCancelReason('');
    }
  }

  async function saveQueue(values) {
    const d = await api(`/queues/${queue.id}`, { method: 'PATCH', body: values });
    setData((cur) => ({ ...cur, queue: d.queue }));
    refreshQueues();
    setEditing(false);
    notify('Queue updated', 'success');
  }

  async function deleteQueue() {
    setPending('delete');
    try {
      await api(`/queues/${queue.id}`, { method: 'DELETE' });
      notify(`Queue “${queue.name}” deleted`, 'success');
      await refreshQueues();
      navigate('/', { replace: true });
    } catch (err) {
      notify(err.message, 'error');
      setPending(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{queue.name}</h1>
          <p>
            {queue.description ? `${queue.description}. ` : ''}
            {queue.servedToday} served today
            {queue.avgWaitToday !== null && `, average wait ${formatMinutes(queue.avgWaitToday)}`}.
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn" to={`/dashboard?queue=${queue.id}`}>
            Analytics
          </Link>
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="btn btn-danger-quiet" onClick={() => setDeleting(true)}>
            Delete
          </button>
        </div>
      </header>

      <div className="desk">
        <section className="desk-side">
          <div className="serving-board" aria-labelledby="serving-title">
            <h2 id="serving-title">Now serving</h2>
            {serving.length === 0 ? (
              <p className="serving-empty">Counter is free. Call the next person when you’re ready.</p>
            ) : (
              <ul className="serving-list">
                {serving.map((t) => (
                  <li key={t.id} className="serving-item">
                    <div className="serving-code">{t.code}</div>
                    <div className="serving-who">
                      <strong>{t.name}</strong>
                      <span>
                        Called {formatTime(t.calledAt)}, waited {formatMinutes(minutesSince(t.createdAt, new Date(t.calledAt)))}
                      </span>
                      {t.note && <span className="note-pill">{t.note}</span>}
                    </div>
                    <div className="serving-actions">
                      <button
                        className="btn btn-success btn-sm"
                        disabled={!!pending}
                        onClick={() => act(`done-${t.id}`, `/tokens/${t.id}/complete`, undefined, `${t.code} marked as served`)}
                      >
                        {pending === `done-${t.id}` ? 'Saving…' : 'Mark served'}
                      </button>
                      <button className="btn-link-light" disabled={!!pending} onClick={() => setCancelTarget(t)}>
                        No-show
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="btn btn-amber call-next"
              disabled={!next || !!pending}
              onClick={() =>
                act('serve', `/queues/${queue.id}/serve-next`, undefined, (d) => `Now serving ${d.token.code} – ${d.token.name}`)
              }
            >
              {pending === 'serve' ? (
                'Calling…'
              ) : next ? (
                <>
                  <span>Call next</span>
                  <span className="call-next-code">{next.code}</span>
                </>
              ) : (
                'Nobody waiting'
              )}
            </button>
          </div>

          <AddTokenForm queue={queue} disabled={!!pending} onAdd={(body) => act('add', `/queues/${queue.id}/tokens`, body, (d) => `Token ${d.token.code} issued – position ${d.token.place}`)} />
        </section>

        <section className="panel line" aria-labelledby="line-title">
          <div className="line-head">
            <h2 id="line-title">Waiting line</h2>
            <span className="line-count">
              {waiting.length} {waiting.length === 1 ? 'person' : 'people'}
            </span>
          </div>
          {waiting.length === 0 ? (
            <div className="empty">
              <h2>The line is empty</h2>
              <p>Issue a token on the left when someone arrives.</p>
            </div>
          ) : (
            <ol className="line-list">
              {waiting.map((t, i) => (
                <li key={t.id} className={`line-item ${i === 0 ? 'is-next' : ''}`}>
                  <span className="line-place" aria-label={`Position ${t.place}`}>
                    {t.place}
                  </span>
                  <TicketStub code={t.code} tone={i === 0 ? 'amber' : 'paper'} size="sm" />
                  <div className="line-who">
                    <strong>{t.name}</strong>
                    <span>
                      Waiting {formatMinutes(minutesSince(t.createdAt, now))}
                      {t.phone && `, ${t.phone}`}
                    </span>
                    {t.note && <span className="note-pill">{t.note}</span>}
                  </div>
                  <div className="line-actions">
                    <button
                      className="icon-btn"
                      title="Move to top"
                      aria-label={`Move ${t.code} to top`}
                      disabled={i === 0 || !!pending}
                      onClick={() => act(`move-${t.id}`, `/tokens/${t.id}/move`, { direction: 'top' })}
                    >
                      <Arrow d={ICON.top} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Move up"
                      aria-label={`Move ${t.code} up`}
                      disabled={i === 0 || !!pending}
                      onClick={() => act(`move-${t.id}`, `/tokens/${t.id}/move`, { direction: 'up' })}
                    >
                      <Arrow d={ICON.up} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Move down"
                      aria-label={`Move ${t.code} down`}
                      disabled={i === waiting.length - 1 || !!pending}
                      onClick={() => act(`move-${t.id}`, `/tokens/${t.id}/move`, { direction: 'down' })}
                    >
                      <Arrow d={ICON.down} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Cancel token"
                      aria-label={`Cancel ${t.code}`}
                      disabled={!!pending}
                      onClick={() => setCancelTarget(t)}
                    >
                      <Arrow d={ICON.x} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="panel history" aria-labelledby="history-title">
        <div className="line-head">
          <h2 id="history-title">Recently finished</h2>
        </div>
        {history.length === 0 ? (
          <p className="empty">Served and cancelled tokens will appear here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Name</th>
                  <th>Outcome</th>
                  <th>Joined</th>
                  <th>Waited</th>
                  <th>Service time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <TicketStub code={t.code} tone="muted" size="sm" />
                    </td>
                    <td>{t.name}</td>
                    <td>
                      {t.status === 'served' ? (
                        <span className="badge badge-served">Served</span>
                      ) : (
                        <span className="badge badge-cancelled" title={t.cancelReason || undefined}>
                          Cancelled{t.cancelReason ? `: ${t.cancelReason}` : ''}
                        </span>
                      )}
                    </td>
                    <td>{formatTime(t.createdAt)}</td>
                    <td>{t.calledAt ? formatMinutes(minutesSince(t.createdAt, new Date(t.calledAt))) : '—'}</td>
                    <td>{t.completedAt ? formatMinutes(minutesSince(t.calledAt, new Date(t.completedAt))) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={!!cancelTarget}
        title={cancelTarget ? `Cancel ${cancelTarget.code}?` : ''}
        message={cancelTarget ? `${cancelTarget.name} will be removed from the queue. This can’t be undone.` : ''}
        confirmLabel="Cancel token"
        danger
        busy={pending === 'cancel'}
        onConfirm={confirmCancel}
        onClose={() => {
          setCancelTarget(null);
          setCancelReason('');
        }}
      >
        <label className="field">
          <span>Reason (optional)</span>
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={140} placeholder="e.g. Left before being called" />
        </label>
      </ConfirmModal>

      <ConfirmModal
        open={deleting}
        title={`Delete “${queue.name}”?`}
        message="The queue, its waiting line and all of its history will be deleted. This can’t be undone."
        confirmLabel="Delete queue"
        danger
        busy={pending === 'delete'}
        onConfirm={deleteQueue}
        onClose={() => setDeleting(false)}
      />

      <Modal open={editing} title="Edit queue" onClose={() => setEditing(false)}>
        <QueueForm initial={queue} submitLabel="Save changes" onSubmit={saveQueue} onCancel={() => setEditing(false)} />
      </Modal>
    </div>
  );
}

function AddTokenForm({ queue, disabled, onAdd }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [more, setMore] = useState(false);
  const nameRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (disabled) return;
    const ok = await onAdd({ name, phone, note });
    if (ok) {
      setName('');
      setPhone('');
      setNote('');
      nameRef.current?.focus();
    }
  }

  return (
    <form className="panel add-token" onSubmit={submit}>
      <h2>Issue a token</h2>
      <label className="field">
        <span>Person’s name</span>
        <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Leave blank for a walk-in" />
      </label>
      {more ? (
        <>
          <label className="field">
            <span>Phone (optional)</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
          </label>
          <label className="field">
            <span>Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="e.g. Needs an interpreter" />
          </label>
        </>
      ) : (
        <button type="button" className="btn-link" onClick={() => setMore(true)}>
          Add phone or note
        </button>
      )}
      <button className="btn btn-primary btn-block" disabled={disabled}>
        Issue token {queue.prefix}-{String(queue.nextNumber).padStart(3, '0')}
      </button>
    </form>
  );
}
