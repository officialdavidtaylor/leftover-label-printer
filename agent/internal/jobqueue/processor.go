package jobqueue

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttstatus"
)

const (
	defaultRetryMaxAttempts   = 5
	defaultRetryInitialDelay  = 5 * time.Second
	defaultRetryMaxDelay      = 60 * time.Second
	defaultRetryMultiplier    = 2.0
	defaultProcessorBatchSize = 100
	defaultFallbackDelay      = 1 * time.Second
)

// Logger mirrors existing consumer logging interfaces for structured operational logs.
type Logger interface {
	Info(event string, fields map[string]any)
	Warn(event string, fields map[string]any)
}

// RetryPolicy configures bounded retry behavior for failed print attempts.
type RetryPolicy struct {
	MaxAttempts  int
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Multiplier   float64
}

// ProcessorConfig configures durable queue execution.
type ProcessorConfig struct {
	Store            *Store
	Executor         printCommandExecutor
	RetryPolicy      RetryPolicy
	Logger           Logger
	Now              func() time.Time
	OutcomePublisher terminalOutcomePublisher
	OutcomeOutbox    terminalOutcomeOutbox
}

type printCommandExecutor interface {
	Execute(ctx context.Context, command jobexec.Command) jobexec.Result
}

type terminalOutcomePublisher interface {
	mqttstatus.OutcomePayloadPublisher
	BuildPrintJobOutcomePayload(input mqttstatus.PublishPrintJobOutcomeInput) (mqttstatus.PrintJobOutcomePayload, error)
}

type terminalOutcomeOutbox interface {
	Enqueue(record mqttstatus.PendingOutcomeRecord) error
	Drain(ctx context.Context, publisher mqttstatus.OutcomePayloadPublisher) (int, error)
	PendingRecord(dispatchEventID string) (mqttstatus.PendingOutcomeRecord, bool, error)
}

// Processor executes queued jobs with bounded retry and dead-letter persistence.
type Processor struct {
	store       *Store
	executor    printCommandExecutor
	retryPolicy RetryPolicy
	logger      Logger
	now         func() time.Time
	outcomes    terminalOutcomePublisher
	outbox      terminalOutcomeOutbox
}

func NewProcessor(config ProcessorConfig) (*Processor, error) {
	if config.Store == nil {
		return nil, errors.New("store is required")
	}
	if config.Executor == nil {
		return nil, errors.New("executor is required")
	}
	if (config.OutcomePublisher == nil) != (config.OutcomeOutbox == nil) {
		return nil, errors.New("outcome publisher and outbox must both be set or both be nil")
	}

	now := config.Now
	if now == nil {
		now = time.Now
	}

	return &Processor{
		store:       config.Store,
		executor:    config.Executor,
		retryPolicy: normalizeRetryPolicy(config.RetryPolicy),
		logger:      config.Logger,
		now:         now,
		outcomes:    config.OutcomePublisher,
		outbox:      config.OutcomeOutbox,
	}, nil
}

// ProcessReady executes all currently ready pending jobs up to one batch.
func (processor *Processor) ProcessReady(ctx context.Context) (int, error) {
	readyJobs, err := processor.store.ListReady(processor.now().UTC(), defaultProcessorBatchSize)
	if err != nil {
		return 0, err
	}

	processed := 0
	for _, queuedJob := range readyJobs {
		if ctx.Err() != nil {
			return processed, nil
		}

		recovered, err := processor.recoverQueuedTerminalOutcome(ctx, queuedJob)
		if err != nil {
			return processed, err
		}
		if recovered {
			processed++
			continue
		}

		result := processor.executor.Execute(ctx, jobexec.Command{
			EventID:   queuedJob.EventID,
			TraceID:   queuedJob.TraceID,
			JobID:     queuedJob.JobID,
			PrinterID: queuedJob.PrinterID,
			ObjectURL: queuedJob.ObjectURL,
		})
		failureTime := processor.now().UTC()

		if result.Outcome != jobexec.OutcomePrinted && ctx.Err() != nil {
			info(processor.logger, "queue_job_interrupted", map[string]any{
				"eventId":   queuedJob.EventID,
				"jobId":     queuedJob.JobID,
				"printerId": queuedJob.PrinterID,
			})
			return processed, nil
		}

		if result.Outcome == jobexec.OutcomePrinted {
			if err := processor.handlePrintedOutcome(ctx, queuedJob, result); err != nil {
				return processed, err
			}
			info(processor.logger, "queue_job_printed", map[string]any{
				"eventId":       queuedJob.EventID,
				"jobId":         queuedJob.JobID,
				"printerId":     queuedJob.PrinterID,
				"attemptNumber": queuedJob.AttemptCount + 1,
				"lpOutput":      result.LPOutput,
			})
			processed++
			continue
		}

		attemptNumber := queuedJob.AttemptCount + 1
		queuedJob.AttemptCount = attemptNumber
		queuedJob.LastErrorCode = result.ErrorCode
		queuedJob.LastErrorMessage = result.ErrorMessage

		if attemptNumber >= processor.retryPolicy.MaxAttempts {
			if err := processor.handleTerminalFailure(ctx, queuedJob, result, failureTime); err != nil {
				return processed, err
			}

			warn(processor.logger, "queue_job_failed_terminal", map[string]any{
				"eventId":       queuedJob.EventID,
				"jobId":         queuedJob.JobID,
				"printerId":     queuedJob.PrinterID,
				"attemptNumber": attemptNumber,
				"maxAttempts":   processor.retryPolicy.MaxAttempts,
				"errorCode":     result.ErrorCode,
				"errorMessage":  result.ErrorMessage,
				"lpOutput":      result.LPOutput,
			})
			processed++
			continue
		}

		retryDelay := processor.retryPolicy.delayForAttempt(attemptNumber)
		queuedJob.NextAttemptAt = failureTime.Add(retryDelay)
		if err := processor.store.SavePending(queuedJob); err != nil {
			return processed, err
		}

		warn(processor.logger, "queue_job_retry_scheduled", map[string]any{
			"eventId":       queuedJob.EventID,
			"jobId":         queuedJob.JobID,
			"printerId":     queuedJob.PrinterID,
			"attemptNumber": attemptNumber,
			"maxAttempts":   processor.retryPolicy.MaxAttempts,
			"errorCode":     result.ErrorCode,
			"errorMessage":  result.ErrorMessage,
			"nextAttemptAt": queuedJob.NextAttemptAt.Format(time.RFC3339Nano),
			"retryDelayMs":  retryDelay.Milliseconds(),
		})

		processed++
	}

	return processed, nil
}

func (processor *Processor) handlePrintedOutcome(
	ctx context.Context,
	queuedJob QueuedJob,
	result jobexec.Result,
) error {
	record, err := processor.queueTerminalOutcome(queuedJob, result, queuedJob.AttemptCount+1)
	if err != nil {
		return err
	}

	if err := processor.store.DeletePending(queuedJob.EventID); err != nil {
		return err
	}

	processor.drainTerminalOutcomes(ctx, queuedJob, record)
	return nil
}

func (processor *Processor) handleTerminalFailure(
	ctx context.Context,
	queuedJob QueuedJob,
	result jobexec.Result,
	failureTime time.Time,
) error {
	queuedJob.AttemptCount = queuedJob.AttemptCount + 1
	queuedJob.LastErrorCode = result.ErrorCode
	queuedJob.LastErrorMessage = result.ErrorMessage

	record, err := processor.queueTerminalOutcome(queuedJob, result, queuedJob.AttemptCount)
	if err != nil {
		return err
	}

	if err := processor.store.MovePendingToFailed(FailedJob{
		QueuedJob:         queuedJob,
		FinalErrorCode:    result.ErrorCode,
		FinalErrorMessage: result.ErrorMessage,
		FinalLPOutput:     result.LPOutput,
		FailedAt:          failureTime,
	}); err != nil {
		return err
	}

	processor.drainTerminalOutcomes(ctx, queuedJob, record)
	return nil
}

func (processor *Processor) queueTerminalOutcome(
	queuedJob QueuedJob,
	result jobexec.Result,
	attemptCount int,
) (mqttstatus.PendingOutcomeRecord, error) {
	if processor.outcomes == nil || processor.outbox == nil {
		return mqttstatus.PendingOutcomeRecord{}, nil
	}

	payload, err := processor.outcomes.BuildPrintJobOutcomePayload(mqttstatus.PublishPrintJobOutcomeInput{
		TraceID:      queuedJob.TraceID,
		JobID:        queuedJob.JobID,
		PrinterID:    queuedJob.PrinterID,
		Outcome:      result.Outcome,
		ErrorCode:    result.ErrorCode,
		ErrorMessage: result.ErrorMessage,
	})
	if err != nil {
		return mqttstatus.PendingOutcomeRecord{}, err
	}

	record := mqttstatus.PendingOutcomeRecord{
		DispatchEventID: queuedJob.EventID,
		AttemptCount:    attemptCount,
		LPOutput:        result.LPOutput,
		Payload:         payload,
	}
	if err := processor.outbox.Enqueue(record); err != nil {
		return mqttstatus.PendingOutcomeRecord{}, err
	}

	return record, nil
}

func (processor *Processor) recoverQueuedTerminalOutcome(ctx context.Context, queuedJob QueuedJob) (bool, error) {
	if processor.outcomes == nil || processor.outbox == nil {
		return false, nil
	}

	record, found, err := processor.outbox.PendingRecord(queuedJob.EventID)
	if err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}

	switch record.Payload.Type {
	case string(jobexec.OutcomePrinted):
		if err := processor.store.DeletePending(queuedJob.EventID); err != nil {
			return false, err
		}
	case string(jobexec.OutcomeFailed):
		failedAt, err := parseOccurredAt(record.Payload.OccurredAt)
		if err != nil {
			return false, err
		}

		queuedJob.AttemptCount = record.AttemptCount
		queuedJob.LastErrorCode = record.Payload.ErrorCode
		queuedJob.LastErrorMessage = record.Payload.ErrorMessage
		if err := processor.store.MovePendingToFailed(FailedJob{
			QueuedJob:         queuedJob,
			FinalErrorCode:    record.Payload.ErrorCode,
			FinalErrorMessage: record.Payload.ErrorMessage,
			FinalLPOutput:     record.LPOutput,
			FailedAt:          failedAt,
		}); err != nil {
			return false, err
		}
	default:
		return false, errors.New("queued terminal outcome has unsupported type")
	}

	processor.drainTerminalOutcomes(ctx, queuedJob, record)
	return true, nil
}

func (processor *Processor) drainTerminalOutcomes(
	ctx context.Context,
	queuedJob QueuedJob,
	record mqttstatus.PendingOutcomeRecord,
) {
	if processor.outcomes == nil || processor.outbox == nil {
		return
	}

	if publishedCount, err := processor.outbox.Drain(ctx, processor.outcomes); err != nil {
		warn(processor.logger, "queue_job_outcome_publish_deferred", map[string]any{
			"eventId":        queuedJob.EventID,
			"jobId":          queuedJob.JobID,
			"printerId":      queuedJob.PrinterID,
			"outcomeEventId": record.Payload.EventID,
			"outcome":        record.Payload.Type,
			"error":          err.Error(),
		})
	} else if publishedCount > 0 {
		info(processor.logger, "queue_job_terminal_outcome_recovered", map[string]any{
			"eventId":        queuedJob.EventID,
			"jobId":          queuedJob.JobID,
			"printerId":      queuedJob.PrinterID,
			"outcomeEventId": record.Payload.EventID,
			"outcome":        record.Payload.Type,
			"publishedCount": publishedCount,
		})
	}
}

func parseOccurredAt(value string) (time.Time, error) {
	occurredAt, err := time.Parse(time.RFC3339Nano, value)
	if err == nil {
		return occurredAt.UTC(), nil
	}

	occurredAt, err = time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}

	return occurredAt.UTC(), nil
}

// NextWakeDelay resolves the next sleep duration based on pending queue state.
func (processor *Processor) NextWakeDelay(now time.Time, fallbackDelay time.Duration) (time.Duration, error) {
	normalizedNow := now.UTC()
	normalizedFallbackDelay := fallbackDelay
	if normalizedFallbackDelay <= 0 {
		normalizedFallbackDelay = defaultFallbackDelay
	}

	nextAttemptAt, hasPending, err := processor.store.NextAttemptAt()
	if err != nil {
		return 0, err
	}
	if !hasPending {
		return normalizedFallbackDelay, nil
	}

	delay := nextAttemptAt.Sub(normalizedNow)
	if delay <= 0 {
		return 0, nil
	}
	if delay > normalizedFallbackDelay {
		return normalizedFallbackDelay, nil
	}

	return delay, nil
}

// RunLoop continuously processes local queue work and waits on schedule or wake signals.
func RunLoop(ctx context.Context, processor *Processor, fallbackDelay time.Duration, wake <-chan struct{}) error {
	if processor == nil {
		return errors.New("processor is required")
	}

	for {
		if ctx.Err() != nil {
			return nil
		}

		if _, err := processor.ProcessReady(ctx); err != nil {
			return err
		}

		nextDelay, err := processor.NextWakeDelay(processor.now(), fallbackDelay)
		if err != nil {
			return err
		}

		if nextDelay <= 0 {
			continue
		}

		timer := time.NewTimer(nextDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		case <-wake:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}
	}
}

func (policy RetryPolicy) delayForAttempt(attemptNumber int) time.Duration {
	normalizedPolicy := normalizeRetryPolicy(policy)
	if attemptNumber <= 1 {
		return normalizedPolicy.InitialDelay
	}

	scaledDelay := float64(normalizedPolicy.InitialDelay) * math.Pow(normalizedPolicy.Multiplier, float64(attemptNumber-1))
	if scaledDelay < float64(normalizedPolicy.InitialDelay) {
		scaledDelay = float64(normalizedPolicy.InitialDelay)
	}
	if scaledDelay > float64(normalizedPolicy.MaxDelay) {
		scaledDelay = float64(normalizedPolicy.MaxDelay)
	}

	return time.Duration(scaledDelay)
}

func normalizeRetryPolicy(policy RetryPolicy) RetryPolicy {
	normalized := policy
	if normalized.MaxAttempts < 1 {
		normalized.MaxAttempts = defaultRetryMaxAttempts
	}
	if normalized.InitialDelay <= 0 {
		normalized.InitialDelay = defaultRetryInitialDelay
	}
	if normalized.MaxDelay <= 0 {
		normalized.MaxDelay = defaultRetryMaxDelay
	}
	if normalized.MaxDelay < normalized.InitialDelay {
		normalized.MaxDelay = normalized.InitialDelay
	}
	if normalized.Multiplier < 1 {
		normalized.Multiplier = defaultRetryMultiplier
	}

	return normalized
}

func info(logger Logger, event string, fields map[string]any) {
	if logger == nil {
		return
	}

	logger.Info(event, fields)
}

func warn(logger Logger, event string, fields map[string]any) {
	if logger == nil {
		return
	}

	logger.Warn(event, fields)
}
