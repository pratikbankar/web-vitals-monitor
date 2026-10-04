import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { Site, Strategy } from '../lib/api';

export function BadgeSnippet({ site, strategy, version }: { site: Site; strategy: Strategy; version: string }) {
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const badge = `${origin}/api/badge/${site._id}.svg${strategy === 'desktop' ? '?strategy=desktop' : ''}`;
  const markdown = `[![Web Vitals](${badge})](${origin}/sites/${site._id})`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text stays selectable in the box.
    }
  }

  return (
    <div>
      <p className="text-sm text-muted">Paste this into a README to show this site's current score and budget status. It updates after every audit.</p>
      {/* The version changes after each audit so the preview is not served from the browser cache. */}
      <img src={`/api/badge/${site._id}.svg?strategy=${strategy}&v=${version}`} alt={`Status badge for ${site.name}`} className="mt-4 h-5" />
      <div className="mt-3 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs">{markdown}</code>
        <button type="button" className="btn btn-ghost shrink-0" onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
