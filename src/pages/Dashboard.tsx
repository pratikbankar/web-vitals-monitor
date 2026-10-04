import { ArrowRight, LoaderCircle, Monitor, Pin, Plus, Smartphone } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScoreRing } from '../components/ScoreRing';
import { StatusChips } from '../components/StatusChips';
import { api, message, type Site, type SiteSummary } from '../lib/api';
import { timeAgo } from '../lib/format';

function AddSite() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('url') ?? '').trim();
    if (!url) {
      setError('Enter a website address');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const site = await api<Site>('/sites', { method: 'POST', body: { url } });
      // The site page starts the first audit, so the visitor sees progress straight away.
      navigate(`/sites/${site._id}?audit=1`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card p-4 sm:p-5">
      <label htmlFor="url" className="text-sm font-medium">Track a website</label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="url" name="url" type="url" inputMode="url" autoComplete="url" placeholder="https://example.com" className="input flex-1"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'url-error' : 'url-help'}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {busy ? 'Adding' : 'Add and audit'}
        </button>
      </div>
      {error
        ? <p id="url-error" role="alert" className="mt-2 text-sm text-poor">{error}</p>
        : <p id="url-help" className="mt-2 text-sm text-muted">Any public page works. The first audit takes about 30 seconds.</p>}
    </form>
  );
}

function SiteCard({ site }: { site: SiteSummary }) {
  const { mobile, desktop } = site.latest;
  const last = [mobile, desktop].map((r) => r?.createdAt).filter(Boolean).sort().at(-1);
  return (
    <Link to={`/sites/${site._id}`} className="card group flex h-full flex-col p-5 transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate font-display text-lg font-semibold">
            <span className="truncate">{site.name}</span>
            {site.pinned && <Pin className="size-3.5 shrink-0 text-muted" aria-label="Example site" />}
          </h2>
          <p className="truncate text-sm text-muted">{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
      </div>

      <div className="mt-5 flex items-center gap-6">
        <div className="flex items-center gap-3">
          <ScoreRing score={mobile?.performance} label="Mobile score" />
          <span className="text-xs text-muted"><Smartphone className="mb-1 size-4" aria-hidden />Mobile</span>
        </div>
        <div className="flex items-center gap-3">
          <ScoreRing score={desktop?.performance} label="Desktop score" />
          <span className="text-xs text-muted"><Monitor className="mb-1 size-4" aria-hidden />Desktop</span>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
        <StatusChips run={mobile ?? desktop} />
        <span className="ml-auto text-xs text-muted">{last ? `Audited ${timeAgo(last)}` : 'Not audited yet'}</span>
      </div>
    </Link>
  );
}

export function Dashboard() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    return api<SiteSummary[]>('/sites').then(setSites).catch((err: unknown) => setError(message(err)));
  }, []);

  useEffect(() => {
    let alive = true;
    api<SiteSummary[]>('/sites')
      .then((s) => alive && setSites(s))
      .catch((err: unknown) => alive && setError(message(err)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <section className="mb-8 grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
        <div>
          <p className="eyebrow">Core Web Vitals, over time</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Know when your site gets slower.</h1>
          <p className="mt-3 max-w-xl text-muted">
            Run Lighthouse audits on any page, watch the trend, get flagged when a metric regresses, and hold each site to a performance budget.
          </p>
        </div>
        <AddSite />
      </section>

      {error ? (
        <div className="card p-8 text-center" role="alert">
          <p className="text-poor">{error}</p>
          <button type="button" className="btn btn-ghost mt-4" onClick={load}>Try again</button>
        </div>
      ) : sites === null ? (
        <p className="py-16 text-center text-muted" role="status">Loading tracked sites</p>
      ) : sites.length === 0 ? (
        <div className="card p-10 text-center text-muted">No sites are tracked yet. Add one above to run its first audit.</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => <li key={site._id}><SiteCard site={site} /></li>)}
        </ul>
      )}
    </>
  );
}
