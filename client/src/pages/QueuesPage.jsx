import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import QueueForm from '../components/QueueForm.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatMinutes, minutesSince } from '../format.js';
import { useNow } from '../hooks.js';

export default function QueuesPage() {
  const { queues, refreshQueues } = useOutletContext();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const notify = useToast();
  const now = useNow(30000);

  async function create(values) {
    const { queue } = await api('/queues', { method: 'POST', body: values });
    await refreshQueues();
    setCreating(false);
    notify(`Queue “${queue.name}” created`, 'success');
    navigate(`/queues/${queue.id}`);
  }

  const totals = (queues ?? []).reduce(
    (acc, q) => ({ waiting: acc.waiting + q.waitingCount, served: acc.served + q.servedToday }),
    { waiting: 0, served: 0 },
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Queues</h1>
          {queues?.length > 0 && (
            <p>
              {totals.waiting} {totals.waiting === 1 ? 'person' : 'people'} waiting across {queues.length}{' '}
              {queues.length === 1 ? 'queue' : 'queues'}, {totals.served} served today.
            </p>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          New queue
        </button>
      </header>

      {queues === null && <div className="panel empty">Loading queues…</div>}

      {queues?.length === 0 && (
        <div className="panel empty">
          <h2>Create your first queue</h2>
          <p>A queue is one line of people waiting for the same service, like a front desk or a billing counter.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New queue
          </button>
        </div>
      )}

      {queues?.length > 0 && (
        <ul className="queue-list">
          {queues.map((q) => (
            <li key={q.id}>
              <Link to={`/queues/${q.id}`} className="queue-row">
                <div className="queue-row-title">
                  <h2>{q.name}</h2>
                  <p>{q.description || `Tokens ${q.prefix}-001 onwards`}</p>
                </div>
                <div className="queue-row-waiting">
                  <strong>{q.waitingCount}</strong>
                  <span>waiting</span>
                </div>
                <dl className="queue-row-stats">
                  <div>
                    <dt>Being served</dt>
                    <dd>{q.servingCount}</dd>
                  </div>
                  <div>
                    <dt>Served today</dt>
                    <dd>{q.servedToday}</dd>
                  </div>
                  <div>
                    <dt>Avg wait today</dt>
                    <dd>{formatMinutes(q.avgWaitToday)}</dd>
                  </div>
                  <div>
                    <dt>Longest waiting</dt>
                    <dd>{q.oldestWaitingSince ? formatMinutes(minutesSince(q.oldestWaitingSince, now)) : '—'}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal open={creating} title="New queue" onClose={() => setCreating(false)}>
        <QueueForm submitLabel="Create queue" onSubmit={create} onCancel={() => setCreating(false)} />
      </Modal>
    </div>
  );
}
