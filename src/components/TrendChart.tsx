import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Run } from '../lib/api';
import { formatMetric, METRICS, type MetricKey } from '../lib/format';

export type TrendMetric = 'performance' | 'lcp' | 'cls' | 'tbt' | 'fcp';
export const TREND_METRICS: TrendMetric[] = ['performance', 'lcp', 'cls', 'tbt', 'fcp'];

const valueOf = (run: Run, metric: TrendMetric) => (metric === 'performance' ? run.performance : run.lab[metric]);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

interface Props {
  runs: Run[];
  metric: TrendMetric;
  /** Budget limit for this metric, drawn as a dashed line. */
  limit?: number | null;
}

export function TrendChart({ runs, metric, limit }: Props) {
  const data = runs.map((run) => ({
    at: run.createdAt,
    value: valueOf(run, metric),
    regressed: run.regressions.some((r) => r.metric === metric),
  }));
  const info = METRICS[metric as MetricKey];

  if (data.filter((d) => d.value !== null).length < 2) {
    return <p className="grid h-64 place-items-center text-center text-sm text-muted">The trend appears after two audits. Run another audit or come back tomorrow.</p>;
  }

  return (
    <div className="h-64" role="img" aria-label={`${info.name} over the last ${data.length} audits`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="at" tickFormatter={shortDate} stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} minTickGap={24} />
          <YAxis
            stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52}
            domain={metric === 'performance' ? [0, 100] : [0, 'auto']}
            tickFormatter={(v: number) => formatMetric(metric, v)}
          />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', fontSize: 13 }}
            labelFormatter={(iso) => new Date(String(iso)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            formatter={(v, _name, item) => [
              `${formatMetric(metric, Number(v))}${(item.payload as { regressed: boolean }).regressed ? ' (regression)' : ''}`,
              info.label,
            ]}
          />
          {typeof limit === 'number' && (
            <ReferenceLine y={limit} stroke="var(--muted)" strokeDasharray="6 4" label={{ value: 'budget', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />
          )}
          <Line
            type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} connectNulls isAnimationActive={false}
            dot={(props) => {
              const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: { regressed: boolean }; index: number };
              if (cx == null || cy == null) return <g key={index} />;
              return payload.regressed
                ? <circle key={index} cx={cx} cy={cy} r={6} fill="var(--poor)" stroke="var(--surface)" strokeWidth={2} />
                : <circle key={index} cx={cx} cy={cy} r={3} fill="var(--accent)" />;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
