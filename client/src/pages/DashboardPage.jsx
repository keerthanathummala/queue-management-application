import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api.js';
import { formatHour, formatMinutes } from '../format.js';
import { usePolling } from '../hooks.js';

// Validated with the dataviz palette checker (CVD separation + 3:1 contrast on white).
const C = { blue: '#5368b5', amber: '#b67c06', grid: '#e6eaf0', axis: '#5b6680' };
const RANGES = [
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
];

const axisProps = {
  tick: { fill: C.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: C.grid },
};

function bucketLabel(iso, bucket) {
  const d = new Date(iso);
  return bucket === 'hour'
    ? d.toLocaleTimeString([], { hour: 'numeric' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tip-row">
          <span className="chart-swatch" style={{ background: p.color }} />
          <span>{p.name}</span>
          <strong>{p.value === null || p.value === undefined ? '—' : unit === 'min' ? formatMinutes(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ title, subtitle, children, wide }) {
  return (
    <section className={`panel chart-panel ${wide ? 'wide' : ''}`}>
      <header>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <div className="chart-body">{children}</div>
    </section>
  );
}

const legendProps = {
  iconType: 'circle',
  iconSize: 8,
  wrapperStyle: { fontSize: 13, color: C.axis, paddingBottom: 8 },
  verticalAlign: 'top',
  align: 'right',
  formatter: (value) => <span style={{ color: C.axis }}>{value}</span>,
};

export default function DashboardPage() {
  const { queues } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const queueId = params.get('queue') || '';
  const range = RANGES.some((r) => r.id === params.get('range')) ? params.get('range') : '7d';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const q = new URLSearchParams({ range, tzOffset: String(new Date().getTimezoneOffset()) });
    if (queueId) q.set('queueId', queueId);
    try {
      const d = await api(`/analytics?${q}`);
      if (mine === seq.current) {
        setData(d);
        setError('');
      }
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    }
  }, [range, queueId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  usePolling(load, 30000);

  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (!value || value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const selected = queues?.find((q) => q.id === queueId);
  const k = data?.kpis;
  const trend = data?.trend.map((t) => ({ ...t, label: bucketLabel(t.start, data.bucket) })) ?? [];
  const byHour = data?.byHour.filter((h) => h.hour >= 6 && h.hour <= 22).map((h) => ({ ...h, label: formatHour(h.hour) })) ?? [];
  const rangeLabel = RANGES.find((r) => r.id === range).label.toLowerCase();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {selected ? selected.name : 'All queues'}, last {rangeLabel}. Updates every 30 seconds.
          </p>
        </div>
        <div className="filters">
          <label className="visually-hidden" htmlFor="queue-filter">
            Queue
          </label>
          <select
            id="queue-filter"
            className="input select"
            value={queueId}
            onChange={(e) => setParam('queue', e.target.value, '')}
          >
            <option value="">All queues</option>
            {queues?.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          <div className="segmented segmented-inline" role="tablist" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.id} role="tab" aria-selected={range === r.id} onClick={() => setParam('range', r.id, '7d')}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && !data && <div className="panel empty">{error}</div>}
      {!error && !data && <div className="panel empty">Crunching the numbers…</div>}
      {queues?.length === 0 && (
        <div className="panel empty">
          <h2>No data yet</h2>
          <p>Create a queue and serve a few tokens to see analytics here.</p>
          <Link className="btn btn-primary" to="/">
            Go to queues
          </Link>
        </div>
      )}

      {data && queues?.length !== 0 && (
        <>
          <section className="panel kpis" aria-label="Key figures">
            <div className="kpi kpi-hero">
              <span className="kpi-label">Average wait</span>
              <strong>{formatMinutes(k.avgWait)}</strong>
              <span className="kpi-sub">
                Median {formatMinutes(k.medianWait)}, 90% called within {formatMinutes(k.p90Wait)}
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Waiting now</span>
              <strong>{k.waitingNow}</strong>
              <span className="kpi-sub">
                {k.longestCurrentWait !== null ? `Longest ${formatMinutes(k.longestCurrentWait)}` : 'Nobody in line'}
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Served</span>
              <strong>{k.served}</strong>
              <span className="kpi-sub">{k.totalTokens} tokens issued</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Avg service time</span>
              <strong>{formatMinutes(k.avgService)}</strong>
              <span className="kpi-sub">{k.servingNow} being served now</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Cancelled</span>
              <strong>{k.cancelRate === null ? '—' : `${k.cancelRate}%`}</strong>
              <span className="kpi-sub">{k.cancelled} tokens</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Busiest hour</span>
              <strong>{k.peakHour === null ? '—' : formatHour(k.peakHour)}</strong>
              <span className="kpi-sub">Most arrivals</span>
            </div>
          </section>

          <div className="charts">
            <ChartPanel
              wide
              title="Queue length over time"
              subtitle={`People waiting per ${data.bucket}: the average and the peak`}
            >
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.axis, strokeWidth: 1 }} />
                  <Legend {...legendProps} />
                  <Area
                    type="monotone"
                    dataKey="avgQueueLength"
                    name="Average waiting"
                    stroke={C.blue}
                    strokeWidth={2}
                    fill={C.blue}
                    fillOpacity={0.1}
                    activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="peakQueueLength"
                    name="Peak waiting"
                    stroke={C.amber}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Average wait over time" subtitle="Minutes from joining the line to being called">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} axisLine={false} />
                  <Tooltip content={<ChartTooltip unit="min" />} cursor={{ stroke: C.axis, strokeWidth: 1 }} />
                  <Line
                    type="monotone"
                    dataKey="avgWait"
                    name="Average wait"
                    stroke={C.blue}
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 3, fill: C.blue, stroke: '#fff', strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Arrivals and served" subtitle={`Tokens per ${data.bucket}`}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,36,64,0.05)' }} />
                  <Legend {...legendProps} />
                  <Bar dataKey="arrivals" name="Arrived" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="served" name="Served" fill={C.amber} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Busiest hours" subtitle={`Arrivals by hour of day, last ${rangeLabel}`}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byHour} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} interval={1} />
                  <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,36,64,0.05)' }} />
                  <Bar dataKey="arrivals" name="Arrivals" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="How long people waited" subtitle="Number of tokens by wait before being called">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.waitDistribution} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,36,64,0.05)' }} />
                  <Bar dataKey="count" name="Tokens" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <section className="panel chart-panel wide">
              <header>
                <h2>By queue</h2>
                <p>Last {rangeLabel}; waiting and serving are live</p>
              </header>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Queue</th>
                      <th className="num">Waiting</th>
                      <th className="num">Serving</th>
                      <th className="num">Served</th>
                      <th className="num">Cancelled</th>
                      <th className="num">Avg wait</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perQueue.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <Link to={`/queues/${q.id}`}>{q.name}</Link>
                        </td>
                        <td className="num">{q.waiting}</td>
                        <td className="num">{q.serving}</td>
                        <td className="num">{q.served}</td>
                        <td className="num">{q.cancelled}</td>
                        <td className="num">{formatMinutes(q.avgWait)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
