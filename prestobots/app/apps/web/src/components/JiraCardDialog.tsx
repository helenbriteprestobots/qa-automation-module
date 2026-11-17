import type { JiraCard, JiraCardDraft, JiraIssueType } from '@ctp/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api';
import { Button, ErrorBox } from './ui';

type Mode = 'create' | 'comment';

/**
 * Pre-fills a Jira card for a failed result, lets the admin edit it, then creates it (or comments on
 * an earlier card for the same test case).
 */
export const JiraCardDialog = ({
  resultId,
  testCaseId,
  runId,
  onClose,
}: {
  resultId: string;
  testCaseId: string;
  runId: string;
  onClose: () => void;
}) => {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<JiraCardDraft | null>(null);
  const [mode, setMode] = useState<Mode>('create');
  const [commentOn, setCommentOn] = useState('');
  const [issueType, setIssueType] = useState<JiraIssueType>('Bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sent, setSent] = useState<JiraCard | null>(null);

  const prepare = useMutation({
    mutationFn: () => api.jiraDraft(resultId),
    onSuccess: (data) => {
      setDraft(data);
      setIssueType(data.issueType);
      setTitle(data.title);
      setDescription(data.description);
      // When the test case already has a card, commenting on it is the default: avoids duplicates.
      if (data.earlierCards[0]) {
        setCommentOn(data.earlierCards[0].issueKey);
        setMode('comment');
      }
    },
  });

  const send = useMutation({
    mutationFn: () =>
      api.sendJira(
        resultId,
        mode === 'create' ? { mode, issueType, title, description } : { mode, issueKey: commentOn, description }
      ),
    onSuccess: (card) => {
      setSent(card);
      void queryClient.invalidateQueries({ queryKey: ['run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['test-case', testCaseId] });
    },
  });

  // Prepare once when the window opens (the guard avoids a second, paid AI call in development mode).
  const started = useRef(false);
  useEffect(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    if (started.current) return;
    started.current = true;
    prepare.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = prepare.isPending || send.isPending;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(event) => busy && event.preventDefault()}
      className="m-auto w-[min(100vw-2rem,48rem)] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="font-semibold">Jira card for {testCaseId}</h2>
        <button type="button" onClick={() => dialogRef.current?.close()} disabled={busy} aria-label="Close" className="text-slate-500 hover:text-slate-900">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
        <ErrorBox error={prepare.error ?? send.error} />

        {prepare.isPending && (
          <p className="flex items-center gap-2 text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing the card…
          </p>
        )}

        {sent ? (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-900 ring-1 ring-emerald-200">
            <p className="font-medium">{sent.kind === 'created' ? `Card ${sent.issueKey} created.` : `Comment added to ${sent.issueKey}.`}</p>
            <a href={sent.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-emerald-800 underline">
              Open in Jira <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        ) : (
          draft && (
            <>
              {draft.note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">{draft.note}</p>}
              {draft.aiWritten && (
                <p className="flex items-center gap-1.5 text-violet-800">
                  <Sparkles className="h-4 w-4" aria-hidden /> The AI wrote the title and "What went wrong". Check them before sending.
                </p>
              )}

              {draft.earlierCards.length > 0 && (
                <fieldset className="space-y-2 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <legend className="sr-only">New card or comment</legend>
                  <p className="font-medium">This test case already has {draft.earlierCards.length === 1 ? 'a card' : 'cards'} in Jira.</p>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={mode === 'comment'} onChange={() => setMode('comment')} />
                    Add a comment to
                    <select
                      value={commentOn}
                      onChange={(event) => {
                        setCommentOn(event.target.value);
                        setMode('comment');
                      }}
                      className="rounded-md border border-slate-300 px-2 py-1"
                    >
                      {draft.earlierCards.map((card) => (
                        <option key={card.id} value={card.issueKey}>
                          {card.issueKey} · {card.title.slice(0, 70)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} />
                    Create a new card
                  </label>
                  <p className="text-xs text-slate-500">The platform doesn't follow the cards' status. Check in Jira whether a card is still open.</p>
                </fieldset>
              )}

              {mode === 'create' && (
                <div className="grid gap-3 sm:grid-cols-[15rem_1fr]">
                  <label>
                    <span className="mb-1 block text-slate-600">Type</span>
                    <select value={issueType} onChange={(event) => setIssueType(event.target.value as JiraIssueType)} className="w-full rounded-md border border-slate-300 px-2 py-1.5">
                      <option value="Bug">Bug: the chatbot misbehaves</option>
                      <option value="Task">Task: something else to do</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-slate-600">Title</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
                  </label>
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-slate-600">{mode === 'create' ? 'Description' : 'Comment'}</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={16}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs leading-relaxed"
                />
              </label>

              <p className="text-xs text-slate-500">
                {mode === 'create' ? (
                  <>
                    Labels: {draft.labels.join(', ')} · No one is assigned: the team assigns it in Jira.
                  </>
                ) : (
                  <>A line saying which run saw it again is added on top.</>
                )}
              </p>
            </>
          )
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={busy}>
          {sent ? 'Close' : 'Cancel'}
        </Button>
        {draft && !sent && (
          <Button
            onClick={() => send.mutate()}
            disabled={busy || !description.trim() || (mode === 'create' ? !title.trim() : !commentOn)}
          >
            {send.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === 'create' ? 'Create card in Jira' : `Add comment to ${commentOn}`}
          </Button>
        )}
      </div>
    </dialog>
  );
};
