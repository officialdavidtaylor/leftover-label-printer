import { useEffect } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';

import { jobStatusLoaded, pollingSettled, pollingStarted } from '../features/job-status/job-status.duck';
import { useJobStatusPolling } from '../features/job-status/use-job-status-polling';
import { getPrintJob } from '../lib/api/print-jobs.client';
import { requireAuthenticatedSession } from '../lib/auth/route-guards';
import { isTerminalPrintState } from '../lib/utils/date';
import { useAppDispatch } from '../store/hooks';
import styles from './app.jobs.$jobId.module.css';

type JobStatusLoaderData =
  | {
      ok: true;
      job: Awaited<ReturnType<typeof getPrintJob>>;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export async function clientLoader({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string | undefined>;
}): Promise<JobStatusLoaderData> {
  const session = requireAuthenticatedSession(request.url);
  const jobId = params.jobId ?? '';

  try {
    const job = await getPrintJob(session.accessToken, jobId);
    return {
      ok: true,
      job,
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error && 'code' in error ? String(error.code) : 'job_lookup_failed',
      message: error instanceof Error ? error.message : 'Unable to load print job status.',
    };
  }
}

clientLoader.hydrate = true;

export default function PrintJobStatusPage() {
  const data: JobStatusLoaderData = useLoaderData();
  const revalidator = useRevalidator();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!data.ok) {
      dispatch(pollingSettled());
      return;
    }

    dispatch(jobStatusLoaded(data.job));
    if (isTerminalPrintState(data.job.state)) {
      dispatch(pollingSettled());
      return;
    }

    dispatch(pollingStarted());
  }, [data, dispatch]);

  useJobStatusPolling({
    state: data.ok ? data.job.state : 'failed',
    onPoll: () => {
      void revalidator.revalidate();
    },
  });

  if (!data.ok) {
    return (
      <section className={styles.page}>
        <div className={styles.card}>
          <h2 className={styles.card__title}>Status unavailable</h2>
          <p className={styles.card__copy}>{data.message}</p>
          <Link className={styles.card__link} to="/app/print/new">
            Back to creator
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.header__eyebrow}>Print status</p>
          <h2 className={styles.header__title} data-testid="job-status-title">
            Job {data.job.jobId}
          </h2>
        </div>
        <p className={styles.header__badge} data-testid="job-status-state">
          {data.job.state}
        </p>
      </div>

      <div className={styles.summaryGrid}>
        <article className={styles.card}>
          <p className={styles.card__label}>Printer</p>
          <p className={styles.card__value}>{data.job.printerId}</p>
        </article>
        <article className={styles.card}>
          <p className={styles.card__label}>Template</p>
          <p className={styles.card__value}>
            {data.job.templateId}
            {data.job.templateVersion ? `@${data.job.templateVersion}` : ''}
          </p>
        </article>
      </div>

      <section className={styles.card}>
        <div className={styles.card__header}>
          <h3 className={styles.card__title}>Event timeline</h3>
          <p className={styles.card__copy}>
            {isTerminalPrintState(data.job.state)
              ? 'This job has reached a terminal state.'
              : 'Polling every 5 seconds until the job reaches a terminal state.'}
          </p>
        </div>
        <ol className={styles.timeline} data-testid="status-timeline">
          {data.job.events.map((event) => (
            <li key={event.eventId} className={styles.timeline__item}>
              <div>
                <p className={styles.timeline__title}>{event.type}</p>
                <p className={styles.timeline__meta}>
                  {event.source} • {new Date(event.occurredAt).toLocaleString()}
                </p>
                {event.errorCode ? (
                  <p className={styles.timeline__error}>Error code: {event.errorCode}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
