import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useFetcher } from 'react-router';

import { submissionFailed, submissionStarted, submissionSucceeded } from '../features/print-creator/print-creator.duck';
import { toastQueued } from '../features/toast/toast.duck';
import { createPrintJob } from '../lib/api/print-jobs.client';
import { requireAuthenticatedSession } from '../lib/auth/route-guards';
import { getFrontendEnv } from '../lib/env';
import { createPrintJobRequestSchema, creatorFormSchema, type CreatorFormValues } from '../lib/schemas/print-jobs';
import { todayIsoDate } from '../lib/utils/date';
import { buildIdempotencyKey } from '../lib/utils/idempotency';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import styles from './app.print.new.module.css';

type CreatorActionResult =
  | {
      ok: true;
      jobId: string;
      state: string;
    }
  | {
      ok: false;
      message: string;
      code: string;
    };

export async function clientAction({ request }: { request: Request }): Promise<CreatorActionResult> {
  const session = requireAuthenticatedSession(request.url);
  const env = getFrontendEnv();
  const rawBody = (await request.json().catch(() => ({}))) as unknown;
  const parsed = creatorFormSchema.safeParse(rawBody);

  if (!parsed.success) {
    return {
      ok: false,
      code: 'form_validation_error',
      message: 'Check the highlighted fields and try again.',
    };
  }

  try {
    const response = await createPrintJob(
      session.accessToken,
      createPrintJobRequestSchema.parse({
        idempotencyKey: buildIdempotencyKey(),
        printerId: env.defaultPrinterId,
        templateId: env.defaultTemplateId,
        templateVersion: env.defaultTemplateVersion,
        payload: parsed.data,
      })
    );

    return {
      ok: true,
      jobId: response.jobId,
      state: response.state,
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error && 'code' in error ? String(error.code) : 'submission_failed',
      message: error instanceof Error ? error.message : 'Unable to submit the print job.',
    };
  }
}

export default function PrintCreatorPage() {
  const fetcher = useFetcher<CreatorActionResult>();
  const dispatch = useAppDispatch();
  const creatorState = useAppSelector((state) => state.printCreator);
  const env = getFrontendEnv();
  const handledToastIdRef = useRef<string | null>(null);

  const form = useForm<CreatorFormValues>({
    resolver: zodResolver(creatorFormSchema),
    defaultValues: {
      itemName: '',
      datePrepared: todayIsoDate(),
    },
  });

  useEffect(() => {
    if (fetcher.state === 'submitting') {
      dispatch(submissionStarted());
    }
  }, [dispatch, fetcher.state]);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    if (fetcher.data.ok) {
      dispatch(submissionSucceeded({ jobId: fetcher.data.jobId }));

      if (handledToastIdRef.current !== fetcher.data.jobId) {
        dispatch(
          toastQueued({
            id: `job-${fetcher.data.jobId}`,
            tone: 'success',
            title: 'Label accepted',
            description: `Print job ${fetcher.data.jobId} is now ${fetcher.data.state}.`,
            href: `/app/jobs/${fetcher.data.jobId}`,
            linkLabel: 'View status',
          })
        );
        handledToastIdRef.current = fetcher.data.jobId;
      }

      form.reset({
        itemName: '',
        datePrepared: todayIsoDate(),
      });

      return;
    }

    dispatch(submissionFailed({ message: fetcher.data.message }));
  }, [dispatch, fetcher.data, form]);

  function handleSubmit(values: CreatorFormValues) {
    void fetcher.submit(values, {
      method: 'post',
      encType: 'application/json',
    });
  }

  return (
    <section className={styles.page}>
      <div className={styles.page__lead}>
        <p className={styles.page__eyebrow}>Launch route</p>
        <h2 className={styles.page__title}>Create a label fast, then follow the status when you need it.</h2>
        <p className={styles.page__description}>
          This MVP stays fixed on one printer and one template so the operator flow can stay tight on
          a phone.
        </p>
      </div>

      <div className={styles.page__grid}>
        <section className={styles.card}>
          <div className={styles.card__header}>
            <h3 className={styles.card__title}>Label details</h3>
            <p className={styles.card__subtitle}>Template `label-default@v1`</p>
          </div>

          <form
            className={styles.form}
            onSubmit={form.handleSubmit(handleSubmit)}
            data-testid="creator-form"
            noValidate
          >
            <label className={styles.form__field}>
              <span className={styles.form__label}>Item name</span>
              <input
                {...form.register('itemName')}
                className={styles.form__input}
                placeholder="Chicken soup"
                autoComplete="off"
                data-testid="item-name-input"
              />
              {form.formState.errors.itemName ? (
                <span className={styles.form__error} data-testid="item-name-error">
                  {form.formState.errors.itemName.message}
                </span>
              ) : null}
            </label>

            <label className={styles.form__field}>
              <span className={styles.form__label}>Date prepared</span>
              <input
                {...form.register('datePrepared')}
                className={styles.form__input}
                type="date"
                data-testid="date-prepared-input"
              />
              {form.formState.errors.datePrepared ? (
                <span className={styles.form__error} data-testid="date-prepared-error">
                  {form.formState.errors.datePrepared.message}
                </span>
              ) : null}
            </label>

            <div className={styles.form__meta}>
              <div className={styles.form__metaRow}>
                <span className={styles.form__metaLabel}>Printer</span>
                <strong data-testid="default-printer-value">{env.defaultPrinterId}</strong>
              </div>
              <div className={styles.form__metaRow}>
                <span className={styles.form__metaLabel}>Template</span>
                <strong>{`${env.defaultTemplateId}@${env.defaultTemplateVersion}`}</strong>
              </div>
            </div>

            {creatorState.lastError ? (
              <p className={styles.form__error} data-testid="creator-submit-error">
                {creatorState.lastError}
              </p>
            ) : null}

            <button
              className={styles.form__submit}
              type="submit"
              disabled={fetcher.state !== 'idle'}
              data-testid="submit-print-button"
            >
              {fetcher.state === 'submitting' ? 'Submitting label…' : 'Print label'}
            </button>
          </form>
        </section>

        <aside className={styles.card}>
          <div className={styles.card__header}>
            <h3 className={styles.card__title}>Latest submission</h3>
            <p className={styles.card__subtitle}>Quick confirmation before you open status history.</p>
          </div>

          {creatorState.lastSubmittedJobId ? (
            <div className={styles.summary} data-testid="latest-submission-card">
              <p className={styles.summary__label}>Most recent job</p>
              <p className={styles.summary__value}>{creatorState.lastSubmittedJobId}</p>
              <p className={styles.summary__copy}>
                A toast appears after each accepted print so you can jump to the status view if the
                kitchen needs follow-up.
              </p>
            </div>
          ) : (
            <div className={styles.summary}>
              <p className={styles.summary__copy}>
                No labels submitted yet in this session. The next accepted job will show up here.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
