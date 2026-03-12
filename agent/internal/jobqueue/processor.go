package jobqueue

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
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
	Store       *Store
	Executor    printCommandExecutor
	RetryPolicy RetryPolicy
	Logger      Logger
	Now         func() time.Time
}

type printCommandExecutor interface {
	Execute(ctx context.Context, command jobexec.Command) jobexec.Result
}

// Processor executes queued jobs with bounded retry and dead-letter persistence.
type Processor struct {
	store       *Store
	executor    printCommandExecutor
	retryPolicy RetryPolicy
	logger      Logger
	now         func() time.Time
}

func NewProcessor(config ProcessorConfig) (*Processor, error) {
	if config.Store == nil {
		return nil, errors.New("store is required")
	}
	if config.Executor == nil {
		return nil, errors.New("executor is required")
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

		result := processor.executor.Execute(ctx, jobexec.Command{
			EventID:   queuedJob.EventID,
			TraceID:   queuedJob.TraceID,
			JobID:     queuedJob.JobID,
			PrinterID: queuedJob.PrinterID,
			ObjectURL: queuedJob.ObjectURL,
		})
		failureTime := processor.now().UTC()

		if ctx.Err() != nil {
			info(processor.logger, "queue_job_interrupted", map[string]any{
				"eventId":   queuedJob.EventID,
				"jobId":     queuedJob.JobID,
				"printerId": queuedJob.PrinterID,
			})
			return processed, nil
		}

		if result.Outcome == jobexec.OutcomePrinted {
			if err := processor.store.DeletePending(queuedJob.EventID); err != nil {
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
			if err := processor.store.MovePendingToFailed(FailedJob{
				QueuedJob:         queuedJob,
				FinalErrorCode:    result.ErrorCode,
				FinalErrorMessage: result.ErrorMessage,
				FinalLPOutput:     result.LPOutput,
				FailedAt:          failureTime,
			}); err != nil {
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
