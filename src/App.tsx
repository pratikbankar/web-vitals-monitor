import { Activity, Moon, Sun } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';

// The site page carries the charting library, so it loads only when it is opened.
const SitePage = lazy(() => import('./pages/SitePage').then((m) => ({ default: m.SitePage })));

function toggleTheme() {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    // Private browsing: the choice just will not be remembered.
  }
}

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink"><Activity className="size-[18px]" aria-hidden /></span>
            Web Vitals Monitor
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/pratikbankar/web-vitals-monitor"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Source code on GitHub"
              className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-accent hover:text-accent"
            >
              <GithubMark />
            </a>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Switch between light and dark theme"
              className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-accent hover:text-accent"
            >
              <Sun className="hidden size-[18px] dark:block" aria-hidden />
              <Moon className="size-[18px] dark:hidden" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/sites/:id"
            element={
              <Suspense fallback={<p className="py-16 text-center text-muted" role="status">Loading</p>}>
                <SitePage />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <div className="py-20 text-center">
                <p className="eyebrow">404</p>
                <h1 className="mt-2 font-display text-3xl font-semibold">Page not found</h1>
                <Link to="/" className="btn btn-primary mt-6">Back to the dashboard</Link>
              </div>
            }
          />
        </Routes>
      </main>

      <footer className="border-t border-line py-6 text-center text-sm text-muted">
        Audits by Google Lighthouse through PageSpeed Insights. Built by{' '}
        <a href="https://pratik-bankar-portfolio.vercel.app" className="underline hover:text-accent">Pratik Bankar</a>.
      </footer>
    </div>
  );
}
