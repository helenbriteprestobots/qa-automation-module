import { AiError, BudgetExceededError, type ProposalRequest } from '@ctp/ai';
import { executeTestCase, exploreBot } from '@ctp/runner';
import {
  type ChatbotMode,
  type Generation,
  type ProposalTrial,
  type TestCase,
  type TrialOutcome,
  isGenerationBusy,
  nextTestCaseId,
} from '@ctp/shared';

import type { AiFacade } from '../ai.ts';
import type { Store } from '../db.ts';
import type { ChannelFactory, RunManager } from '../runManager.ts';
import { readBookingForm } from './formSummary.ts';

export class GenerationConflictError extends Error {}
export class GenerationInputError extends Error {}

export interface GenerationOptions {
  /** Local copy of the chatbot code, to read the WhatsApp booking form (stage mode only). */
  chatbotRepoDir?: string;
  maxDepth?: number;
  maxPaths?: number;
  maxProposals?: number;
  /** How many times each proposal is tried before showing it. */
  attempts?: number;
}

const outcomeOf = (statuses: string[]): TrialOutcome => {
  if (statuses.every((s) => s === 'passed')) return 'passed';
  if (statuses.every((s) => s === 'failed')) return 'failed';
  if (statuses.every((s) => s === 'error')) return 'error';
  return 'inconsistent';
};

/**
 * "Generate test cases", one job at a time:
 * 1. explores the bot's menus (uses the chatbot, so no run can happen at the same time);
 * 2. waits for the admin to accept the estimated AI cost;
 * 3. the AI writes proposals, saved as test cases "to review";
 * 4. each proposal is tried twice, to flag the ones that fail or behave inconsistently.
 */
export class GenerationManager {
  private active: { id: string; controller: AbortController; done: Promise<void> } | null = null;
  /** Returns a reason when something else is using the chatbot (e.g. a test message). */
  private blocker: () => string | null = () => null;

  constructor(
    private readonly store: Store,
    private readonly channelFactory: ChannelFactory,
    private readonly mode: ChatbotMode,
    private readonly ai: AiFacade,
    private readonly runs: RunManager,
    private readonly options: GenerationOptions = {}
  ) {}

  setBlocker(blocker: () => string | null): void {
    this.blocker = blocker;
  }

  /** The job currently using the chatbot or the AI, if any. */
  activeId(): string | null {
    return this.active?.id ?? null;
  }

  async whenIdle(): Promise<void> {
    await this.active?.done;
  }

  /** Jobs left half-way by a previous stop of the platform. Proposals already saved are kept. */
  recoverInterrupted(): void {
    for (const generation of this.store.listGenerations(50)) {
      if (isGenerationBusy(generation.status)) {
        this.store.saveGeneration({
          ...generation,
          status: 'interrupted',
          progress: 'The platform was stopped while this was in progress.',
          finishedAt: new Date().toISOString(),
        });
      }
    }
  }

  start(): Generation {
    this.assertCanUseChatbot();
    this.assertAiReady();
    const generation: Generation = {
      id: this.store.nextGenerationId(),
      status: 'exploring',
      mode: this.mode,
      progress: 'Connecting to the chatbot…',
      proposals: [],
      trials: [],
      notes: [],
      costUsd: 0,
      createdAt: new Date().toISOString(),
    };
    this.store.saveGeneration(generation);
    this.launch(generation.id, (signal) => this.explore(generation, signal));
    return generation;
  }

  /** The admin accepted the estimated cost: the AI writes the proposals, then each one is tried. */
  confirm(id: string): Generation {
    const generation = this.require(id);
    if (generation.status !== 'awaiting_confirmation') {
      throw new GenerationInputError('This generation is not waiting for confirmation.');
    }
    this.assertCanUseChatbot();
    this.assertAiReady();
    const writing = this.save(generation, { status: 'writing', progress: 'The AI is writing proposals. This can take a minute…' });
    this.launch(id, (signal) => this.writeAndTry(writing, signal));
    return writing;
  }

  cancel(id: string): Generation {
    const generation = this.require(id);
    if (this.active?.id === id) {
      this.active.controller.abort();
      return generation;
    }
    if (generation.status === 'awaiting_confirmation') {
      return this.save(generation, { status: 'cancelled', progress: 'Cancelled before the AI wrote anything.', finishedAt: new Date().toISOString() });
    }
    throw new GenerationInputError('This generation is not in progress.');
  }

  // ── Steps ──────────────────────────────────────────────────────────────────

  private async explore(generation: Generation, signal: AbortSignal): Promise<void> {
    let current = generation;
    const channel = await this.channelFactory();
    try {
      const map = await exploreBot({
        channel,
        signal,
        maxDepth: this.options.maxDepth ?? 3,
        maxPaths: this.options.maxPaths ?? 25,
        onProgress: ({ explored, path }) => {
          current = this.save(current, {
            progress: `Exploring the bot's menus: path ${explored + 1}${path.length > 0 ? ` (${['Hola', ...path].join(' → ')})` : ''}…`,
          });
        },
      });
      const form = this.mode === 'stage' && this.options.chatbotRepoDir ? await readBookingForm(this.options.chatbotRepoDir) : undefined;
      const estimate = this.ai.estimateProposal(this.request({ ...current, map, form }));
      const failedPaths = map.nodes.filter((node) => node.error).length;
      this.save(current, {
        status: 'awaiting_confirmation',
        map,
        form,
        estimate,
        progress:
          `Explored ${map.nodes.length} menu paths${failedPaths > 0 ? ` (${failedPaths} could not be completed)` : ''}. ` +
          'Waiting for your OK to let the AI write proposals.',
      });
    } finally {
      await channel.dispose?.().catch(() => undefined);
    }
  }

  private async writeAndTry(generation: Generation, signal: AbortSignal): Promise<void> {
    let current = generation;
    const { proposals, notes } = await this.ai.propose(this.request(current), signal);

    // Save the proposals as test cases "to review".
    const now = new Date().toISOString();
    const ids = this.store.listTestCases().map((t) => t.id);
    const saved: TestCase[] = [];
    for (const proposal of proposals) {
      const id = nextTestCaseId(proposal.area, [...ids, ...saved.map((t) => t.id)]);
      const testCase: TestCase = {
        id,
        title: proposal.title,
        area: proposal.area,
        story: proposal.story,
        steps: proposal.steps,
        status: 'proposed',
        origin: 'generated',
        proposal: { generationId: current.id, why: proposal.why },
        createdAt: now,
        updatedAt: now,
      };
      this.store.saveTestCase(testCase);
      saved.push(testCase);
      notes.push(...proposal.assumptions.map((a) => `${id}: ${a}`));
    }
    current = this.save(current, {
      status: 'trying',
      proposals: saved.map((t) => t.id),
      notes,
      progress: saved.length > 0 ? `The AI proposed ${saved.length} test cases. Trying each one…` : 'The AI found nothing new to propose.',
    });
    if (saved.length === 0) return;

    const attempts = this.options.attempts ?? 2;
    const judge = this.ai.forRuns()?.judge;
    const channel = await this.channelFactory();
    try {
      for (const [index, testCase] of saved.entries()) {
        const results = [];
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          signal.throwIfAborted();
          current = this.save(current, {
            progress: `Trying proposal ${index + 1} of ${saved.length} (${testCase.id}), attempt ${attempt} of ${attempts}…`,
          });
          results.push(
            await executeTestCase({
              testCase,
              channel,
              runId: `generation-${current.id}`,
              resultId: `generation-${current.id}-${testCase.id}-${attempt}`,
              signal,
              judge,
            })
          );
        }
        const trial: ProposalTrial = {
          testCaseId: testCase.id,
          outcome: outcomeOf(results.map((r) => r.status)),
          attempts: results.map((r) => r.status),
          result: results[0]!,
        };
        current = this.save(current, { trials: [...current.trials, trial] });
      }
    } finally {
      await channel.dispose?.().catch(() => undefined);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private request(generation: Pick<Generation, 'map' | 'form'>): ProposalRequest {
    const all = this.store.listTestCases();
    return {
      mode: this.mode,
      map: generation.map ?? { nodes: [], truncated: false },
      form: generation.form,
      existing: all.filter((t) => t.status !== 'rejected'),
      rejected: all
        .filter((t) => t.status === 'rejected')
        .map((t) => ({ title: t.title, story: t.story, reason: t.proposal?.rejectedReason })),
      maxProposals: this.options.maxProposals ?? 8,
    };
  }

  private launch(id: string, work: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    const done = work(controller.signal)
      .then(() => {
        const generation = this.require(id);
        if (generation.status === 'writing' || generation.status === 'trying') {
          const count = generation.proposals.length;
          const flagged = generation.trials.filter((t) => t.outcome !== 'passed').length;
          this.save(generation, {
            status: 'finished',
            progress:
              count === 0
                ? 'Done. The AI found nothing new to propose.'
                : `Done: ${count} proposals to review${flagged > 0 ? `, ${flagged} of them did not pass their trial` : ''}.`,
            finishedAt: new Date().toISOString(),
          });
        }
      })
      .catch((error: unknown) => {
        const generation = this.require(id);
        const message =
          controller.signal.aborted
            ? undefined
            : error instanceof AiError || error instanceof BudgetExceededError
              ? error.message
              : `Unexpected problem: ${(error as Error).message}`;
        this.save(generation, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          progress: controller.signal.aborted
            ? `Cancelled.${generation.proposals.length > 0 ? ' The proposals already written are kept in "To review".' : ''}`
            : 'Stopped because of a problem.',
          error: message,
          finishedAt: new Date().toISOString(),
        });
      })
      .finally(() => {
        this.active = null;
      });
    this.active = { id, controller, done };
  }

  private save(generation: Generation, changes: Partial<Generation>): Generation {
    const updated = { ...generation, ...changes, costUsd: this.store.aiSpendSince(generation.createdAt) };
    this.store.saveGeneration(updated);
    return updated;
  }

  private require(id: string): Generation {
    const generation = this.store.getGeneration(id);
    if (!generation) throw new GenerationInputError(`Generation #${id} does not exist.`);
    return generation;
  }

  private assertCanUseChatbot(): void {
    if (this.active) throw new GenerationConflictError('Another "Generate test cases" is in progress. Wait for it or cancel it.');
    const run = this.runs.activeRunId();
    if (run) throw new GenerationConflictError(`Run #${run} is in progress. Wait for it to finish: both use the same test patient.`);
    const blocked = this.blocker();
    if (blocked) throw new GenerationConflictError(blocked);
  }

  private assertAiReady(): void {
    const status = this.ai.status();
    if (!status.enabled) {
      throw new GenerationInputError('Generating test cases needs the AI. Add ANTHROPIC_API_KEY to the .env file and restart the platform.');
    }
    if (status.budget.level === 'exhausted') {
      throw new GenerationInputError('The monthly AI budget has been reached. Raise it in Settings to generate test cases.');
    }
  }
}
