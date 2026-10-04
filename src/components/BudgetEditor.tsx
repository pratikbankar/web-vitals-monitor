import { LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, type Budget, message, type Site } from '../lib/api';

const FIELDS: Array<{ key: keyof Budget; label: string; unit: string; step: string; placeholder: string }> = [
  { key: 'performance', label: 'Score at least', unit: 'points', step: '1', placeholder: '90' },
  { key: 'lcp', label: 'LCP at most', unit: 'ms', step: '50', placeholder: '2500' },
  { key: 'cls', label: 'CLS at most', unit: '', step: '0.01', placeholder: '0.1' },
  { key: 'tbt', label: 'TBT at most', unit: 'ms', step: '10', placeholder: '200' },
];

export function BudgetEditor({ site, onSaved }: { site: Site; onSaved: (site: Site) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: Budget = {};
    for (const { key } of FIELDS) {
      const raw = String(data.get(key) ?? '').trim();
      body[key] = raw === '' ? null : Number(raw);
    }
    setBusy(true);
    setNote(null);
    try {
      onSaved(await api<Site>(`/sites/${site._id}/budget`, { method: 'PUT', body }));
      setNote({ kind: 'ok', text: 'Budget saved. It applies from the next audit.' });
    } catch (err) {
      setNote({ kind: 'error', text: message(err) });
    } finally {
      setBusy(false);
    }
  }

  if (site.pinned) {
    const set = FIELDS.filter((f) => typeof site.budget?.[f.key] === 'number');
    return (
      <div>
        <p className="text-sm text-muted">This is an example site, so its budget is fixed. Add your own site to set one.</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {set.length === 0 && <li className="text-muted">No budget set.</li>}
          {set.map((f) => (
            <li key={f.key} className="rounded-lg border border-line px-3 py-1.5">{f.label} <span className="font-mono font-semibold">{site.budget?.[f.key]}</span> {f.unit}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="text-sm text-muted">Set the limits this site must stay within. Leave a field empty for no limit.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-sm font-medium">
            {f.label}
            <input
              name={f.key} type="number" min="0" step={f.step} inputMode="decimal" placeholder={f.placeholder}
              defaultValue={site.budget?.[f.key] ?? ''} className="input mt-1.5 font-mono"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-ghost" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />} Save budget
        </button>
        <p role="status" className={`text-sm ${note?.kind === 'error' ? 'text-poor' : 'text-good'}`}>{note?.text}</p>
      </div>
    </form>
  );
}
