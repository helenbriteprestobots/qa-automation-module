import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { api } from './api';
import { BudgetLegend } from './components/BudgetLegend';
import { GeneratePage } from './pages/GeneratePage';
import { RunDetailPage } from './pages/RunDetailPage';
import { RunsPage } from './pages/RunsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TestCaseEditorPage } from './pages/TestCaseEditorPage';
import { TestCaseDetailPage } from './pages/TestCaseDetailPage';
import { TestCasesPage } from './pages/TestCasesPage';

export const App = () => {
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 10_000 });

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <FlaskConical className="h-5 w-5 text-emerald-600" aria-hidden />
            Chatbot Testing Platform
          </Link>
          <nav className="flex gap-1">
            <NavLink to="/test-cases" className={navClass}>
              Test cases
            </NavLink>
            <NavLink to="/runs" className={navClass}>
              Runs
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {status.data?.activeGenerationId && (
              <Link to={`/generate/${status.data.activeGenerationId}`} className="flex items-center gap-1 text-violet-700 hover:underline">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Generating test cases
              </Link>
            )}
            {status.data?.activeRunId && (
              <Link to={`/runs/${status.data.activeRunId}`} className="flex items-center gap-1 text-sky-700 hover:underline">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Run #{status.data.activeRunId} in progress
              </Link>
            )}
            {status.data && <BudgetLegend ai={status.data.ai} />}
            {status.data && (
              <span
                title={status.data.target}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  status.data.mode === 'demo'
                    ? 'bg-amber-100 text-amber-900'
                    : status.data.ready
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-100 text-red-800'
                }`}
              >
                {status.data.mode === 'demo' ? 'DEMO bot' : status.data.target}
              </span>
            )}
          </div>
        </div>
      </header>

      {status.data && (status.data.problems.length > 0 || status.data.notes.length > 0) && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          {status.data.problems.length > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
              <p className="font-medium">Runs against the chatbot will fail until this is fixed:</p>
              <ul className="mt-1 list-disc pl-5">
                {status.data.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          {status.data.notes.map((note) => (
            <p key={note} className="mt-2 text-xs text-slate-500">
              {note}
            </p>
          ))}
        </div>
      )}

      {status.isError && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
            The platform server is not answering. Is it running?
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/test-cases" replace />} />
          <Route path="/test-cases" element={<TestCasesPage />} />
          <Route path="/test-cases/new" element={<TestCaseEditorPage />} />
          <Route path="/test-cases/:id" element={<TestCaseDetailPage />} />
          <Route path="/test-cases/:id/edit" element={<TestCaseEditorPage />} />
          <Route path="/generate" element={<GeneratePage />} />
          <Route path="/generate/:id" element={<GeneratePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
};
