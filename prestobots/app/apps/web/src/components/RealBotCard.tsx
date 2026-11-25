import type { ChatMessage, StageChecks } from '@ctp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api';
import { checkSymbol, signInNotice } from '../stageSettings';
import { Button, Card, ErrorBox } from './ui';

const SYMBOL_STYLES = { passed: 'text-emerald-700', failed: 'text-red-700', skipped: 'text-slate-400' } as const;

const Reply = ({ message, seconds }: { message: ChatMessage; seconds?: number }) => (
  <div className="text-sm">
    <span className="font-medium">{message.from === 'patient' ? 'You' : message.from === 'bot' ? 'Bot' : 'Note'}</span>
    {seconds !== undefined && <span className="text-slate-500"> ({seconds.toFixed(1)} s)</span>}: {message.text}
    {message.options.length > 0 && (
      <span className="ml-1">
        {message.options.map((option) => (
          <span key={option.id} className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {option.title}
          </span>
        ))}
      </span>
    )}
  </div>
);

/** Settings card for the real bot on salud-stage: Google sign-in, the connection check and a test "hola". */
export const RealBotCard = ({ demo }: { demo: boolean }) => {
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState(0);
  const notice = signInNotice(window.location.search);
  const checks = useQuery({
    queryKey: ['stage-checks', fresh],
    queryFn: () => api.stageChecks(fresh > 0),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['status'] });
  };
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stage-checks'] });
      refresh();
    },
  });
  const hola = useMutation({ mutationFn: api.sendTestMessage });
  const data: StageChecks | undefined = checks.data;
  const signInUrl = `/api/google/sign-in?from=${encodeURIComponent(window.location.origin)}`;
  const firstBotReply = hola.data?.replies.find((reply) => reply.from === 'bot' || reply.from === 'staff');

  return (
    <Card className="p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Real bot (salud-stage)</h2>
          {demo && <p className="mt-1 text-sm text-slate-600">Only needed for the real bot (CHATBOT_MODE=stage).</p>}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setFresh((n) => n + 1);
            refresh();
          }}
          disabled={checks.isFetching}
        >
          {checks.isFetching ? 'Checking…' : 'Check again'}
        </Button>
      </div>

      {notice && (
        <p className={`mt-3 text-sm ${notice.kind === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{notice.text}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-500">Google account:</span>
        {data?.account ? (
          <>
            <span>Signed in as {data.account.email}</span>
            <Button variant="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <span>Not signed in</span>
            <a href={signInUrl} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
              Sign in with Google
            </a>
          </>
        )}
      </div>

      <ErrorBox error={checks.error ?? signOut.error} />
      {data && (
        <ul className="mt-4 space-y-1.5 text-sm">
          {data.checks.map((check) => (
            <li key={check.id} className="flex gap-2">
              <span className={`w-4 shrink-0 ${SYMBOL_STYLES[check.state]}`}>{checkSymbol(check.state)}</span>
              <span>
                <span className="font-medium">{check.label}</span>
                <span className="text-slate-600"> — {check.message}</span>
                {check.state === 'failed' && check.fix && <span className="block text-slate-700">{check.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => hola.mutate()} disabled={!data?.ready || hola.isPending}>
          {hola.isPending ? 'Waiting for the bot…' : 'Send test hola'}
        </Button>
        <span className="text-xs text-slate-500">Sends one message as the test patient and shows the bot's reply.</span>
      </div>
      <ErrorBox error={hola.error} />
      {hola.data && (
        <div className="mt-3 space-y-1 rounded-md bg-slate-50 p-3">
          <Reply message={hola.data.sent} />
          {hola.data.replies.map((reply) => (
            <Reply key={reply.id} message={reply} seconds={reply === firstBotReply ? hola.data.replySeconds : undefined} />
          ))}
        </div>
      )}
    </Card>
  );
};
