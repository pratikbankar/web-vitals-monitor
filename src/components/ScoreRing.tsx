import { rate } from '../lib/format';

/** The Lighthouse-style score dial. Shows a dash when there is no audit yet. */
export function ScoreRing({ score, size = 64, label }: { score: number | null | undefined; size?: number; label: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const value = score ?? 0;
  const rating = rate('performance', score);
  return (
    <div className={`relative grid place-items-center rating-${rating}`} style={{ width: size, height: size }} role="img" aria-label={`${label}: ${score ?? 'no audit yet'}`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        {score != null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
          />
        )}
      </svg>
      <span className="absolute font-mono font-semibold" style={{ fontSize: size * 0.3 }}>{score ?? '–'}</span>
    </div>
  );
}
