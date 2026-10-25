// Background AI jobs (desktop). A job keeps running when its dialog is closed
// or another guide is opened; listeners get progress and the final result.
// Applying the result to the guide is up to the caller (main.js), which knows
// whether the guide is open in the editor (undoable) or only in storage.
import { improveSteps, understandGuide, writeSummary } from './ai.js';
import { isNumbered } from './render.js';

const jobs = new Map(); // guideId -> job
const listeners = new Set();
const emit = (job) => listeners.forEach((fn) => fn(job));

export const onJobChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getJob = (guideId) => jobs.get(guideId);
export const isRunning = (guideId) => jobs.get(guideId)?.status === 'running';

/** Milliseconds left, estimated from the pace so far (null until the first batch lands). */
export function estimateRemaining(job) {
  if (!job.done || job.done >= job.total) return null;
  const perStep = (Date.now() - job.stepsStartedAt) / job.done;
  return Math.max(0, perStep * (job.total - job.done));
}

/**
 * @param guide   the guide to improve (a snapshot is taken)
 * @param options { provider, style: 'crisp'|'elaborate'|'conceptual', steps: bool, summary: bool }
 */
export function startJob(guide, { provider, style = 'elaborate', steps = true, summary = true } = {}) {
  const running = jobs.get(guide.id);
  if (running?.status === 'running') return running;

  // Snapshot so edits made while the job runs don't change what is sent.
  const snapshot = { ...guide, steps: guide.steps.map((s) => ({ ...s })) };
  const numbered = snapshot.steps.filter((s) => isNumbered(s) && s.text);
  const controller = new AbortController();
  const job = {
    guideId: guide.id,
    title: guide.title || 'Untitled guide',
    style,
    provider,
    status: 'running', // running | done | failed | cancelled
    phase: style === 'conceptual' ? 'Understanding the workflow…' : 'Starting…',
    done: 0,
    total: steps ? numbered.length : 0,
    startedAt: Date.now(),
    stepsStartedAt: Date.now(),
    errors: [],
    models: new Set(),
    // Text of each step when the job started; steps edited meanwhile are left alone.
    original: new Map(numbered.map((s) => [s.id, s.text])),
    stepIdByNumber: new Map(numbered.map((s, i) => [i + 1, s.id])),
    options: { steps, summary },
    result: null,
    controller,
  };
  jobs.set(guide.id, job);
  emit(job);

  (async () => {
    const out = { steps: new Map(), sections: [] };
    try {
      let context = null;
      if (style === 'conceptual') {
        context = await understandGuide(snapshot);
        job.models.add(context.model);
        out.sections = context.sections;
        out.goal = context.goal;
      }
      if (controller.signal.aborted) return;
      job.phase = steps ? 'Rewriting steps…' : 'Writing the title and description…';
      job.stepsStartedAt = Date.now();
      emit(job);

      const tasks = [];
      if (steps) {
        tasks.push(
          improveSteps(snapshot, {
            provider,
            style,
            context,
            signal: controller.signal,
            onProgress: (done, total) => {
              job.done = done;
              job.total = total;
              emit(job);
            },
          }).then((r) => {
            out.steps = r.results;
            job.errors.push(...r.errors);
            r.models.forEach((m) => job.models.add(m));
          }),
        );
      }
      if (summary) {
        tasks.push(
          writeSummary(snapshot, { style, context })
            .then((r) => {
              out.title = r.title;
              out.description = r.description;
              job.models.add(r.model);
            })
            .catch((err) => job.errors.push(`Title: ${err.message}`)),
        );
      }
      await Promise.all(tasks);
    } catch (err) {
      job.errors.push(err.message);
    }
    if (controller.signal.aborted) return;
    job.result = out;
    job.finishedAt = Date.now();
    job.status = out.steps.size || out.title || out.description ? 'done' : 'failed';
    emit(job);
  })();
  return job;
}

export function cancelJob(guideId) {
  const job = jobs.get(guideId);
  if (job?.status !== 'running') return;
  job.controller.abort();
  job.status = 'cancelled';
  emit(job);
}

export function clearJob(guideId) {
  if (jobs.get(guideId)?.status !== 'running') jobs.delete(guideId);
}
