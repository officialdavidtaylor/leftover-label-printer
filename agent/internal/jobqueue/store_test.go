package jobqueue

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
)

func TestStoreEnqueuePersistsAcrossRestart(t *testing.T) {
	spoolDir := t.TempDir()
	store := mustStore(t, spoolDir)

	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	queuedJob, created, err := store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("enqueue returned error: %v", err)
	}
	if !created {
		t.Fatal("expected enqueue to create a pending record")
	}

	restartedStore := mustStore(t, spoolDir)
	readyJobs, err := restartedStore.ListReady(now, 10)
	if err != nil {
		t.Fatalf("list ready returned error: %v", err)
	}
	if len(readyJobs) != 1 {
		t.Fatalf("expected one ready job, got %d", len(readyJobs))
	}
	if readyJobs[0].EventID != queuedJob.EventID {
		t.Fatalf("expected event %q, got %q", queuedJob.EventID, readyJobs[0].EventID)
	}
}

func TestStoreEnqueueSkipsDuplicatePendingAndFailed(t *testing.T) {
	store := mustStore(t, t.TempDir())
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)

	_, created, err := store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("first enqueue returned error: %v", err)
	}
	if !created {
		t.Fatal("expected first enqueue to create record")
	}

	_, created, err = store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("second enqueue returned error: %v", err)
	}
	if created {
		t.Fatal("expected second enqueue to be ignored as duplicate")
	}

	failedCommand := jobexec.Command{
		EventID:   "event-failed",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/label.pdf",
	}
	failedQueuedJob, created, err := store.Enqueue(failedCommand, now)
	if err != nil {
		t.Fatalf("enqueue failed command returned error: %v", err)
	}
	if !created {
		t.Fatal("expected failed command to create pending record")
	}

	if err := store.MovePendingToFailed(FailedJob{
		QueuedJob:         failedQueuedJob,
		FinalErrorCode:    "print_failed",
		FinalErrorMessage: "lp command failed",
		FailedAt:          now,
	}); err != nil {
		t.Fatalf("move pending to failed returned error: %v", err)
	}

	_, created, err = store.Enqueue(failedCommand, now)
	if err != nil {
		t.Fatalf("enqueue after failed returned error: %v", err)
	}
	if created {
		t.Fatal("expected failed event id to remain deduped")
	}
}

func TestStoreUsesCollisionFreeEventIDFilenames(t *testing.T) {
	store := mustStore(t, t.TempDir())
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)

	_, created, err := store.Enqueue(jobexec.Command{
		EventID:   "evt/1",
		TraceID:   "trace-1",
		JobID:     "job-1",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/1.pdf",
	}, now)
	if err != nil {
		t.Fatalf("enqueue evt/1 returned error: %v", err)
	}
	if !created {
		t.Fatal("expected evt/1 to create pending record")
	}

	_, created, err = store.Enqueue(jobexec.Command{
		EventID:   "evt:1",
		TraceID:   "trace-2",
		JobID:     "job-2",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/2.pdf",
	}, now)
	if err != nil {
		t.Fatalf("enqueue evt:1 returned error: %v", err)
	}
	if !created {
		t.Fatal("expected evt:1 to create pending record")
	}

	if store.pendingPath("evt/1") == store.pendingPath("evt:1") {
		t.Fatal("expected collision-free pending file paths")
	}

	readyJobs, err := store.ListReady(now, 10)
	if err != nil {
		t.Fatalf("list ready returned error: %v", err)
	}
	if len(readyJobs) != 2 {
		t.Fatalf("expected two ready jobs, got %d", len(readyJobs))
	}
}

func TestStoreSavePendingAndNextAttemptAt(t *testing.T) {
	store := mustStore(t, t.TempDir())
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)

	queuedJob, created, err := store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("enqueue returned error: %v", err)
	}
	if !created {
		t.Fatal("expected enqueue to create record")
	}

	queuedJob.AttemptCount = 1
	queuedJob.LastErrorCode = "download_failed"
	queuedJob.LastErrorMessage = "timeout"
	queuedJob.NextAttemptAt = now.Add(3 * time.Minute)
	if err := store.SavePending(queuedJob); err != nil {
		t.Fatalf("save pending returned error: %v", err)
	}

	nextAttemptAt, hasPending, err := store.NextAttemptAt()
	if err != nil {
		t.Fatalf("next attempt returned error: %v", err)
	}
	if !hasPending {
		t.Fatal("expected pending jobs")
	}
	if !nextAttemptAt.Equal(queuedJob.NextAttemptAt) {
		t.Fatalf("unexpected next attempt time: got %s want %s", nextAttemptAt, queuedJob.NextAttemptAt)
	}

	readyJobs, err := store.ListReady(now, 10)
	if err != nil {
		t.Fatalf("list ready returned error: %v", err)
	}
	if len(readyJobs) != 0 {
		t.Fatalf("expected no ready jobs before nextAttemptAt, got %d", len(readyJobs))
	}

	readyJobs, err = store.ListReady(now.Add(5*time.Minute), 10)
	if err != nil {
		t.Fatalf("list ready returned error: %v", err)
	}
	if len(readyJobs) != 1 {
		t.Fatalf("expected one ready job, got %d", len(readyJobs))
	}

	if err := store.DeletePending(queuedJob.EventID); err != nil {
		t.Fatalf("delete pending returned error: %v", err)
	}

	nextAttemptAt, hasPending, err = store.NextAttemptAt()
	if err != nil {
		t.Fatalf("next attempt returned error: %v", err)
	}
	if hasPending || !nextAttemptAt.IsZero() {
		t.Fatalf("expected no pending jobs after delete, got hasPending=%v next=%s", hasPending, nextAttemptAt)
	}
}

func TestProcessorTerminalFailureWritesDeadLetter(t *testing.T) {
	spoolDir := t.TempDir()
	store := mustStore(t, spoolDir)
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	_, _, err := store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("enqueue returned error: %v", err)
	}

	processor, err := NewProcessor(ProcessorConfig{
		Store: store,
		Executor: fakeExecutor{execute: func(context.Context, jobexec.Command) jobexec.Result {
			return jobexec.Result{Outcome: jobexec.OutcomeFailed, ErrorCode: "print_failed", ErrorMessage: "busy"}
		}},
		RetryPolicy: RetryPolicy{MaxAttempts: 1, InitialDelay: time.Second, MaxDelay: time.Second, Multiplier: 2},
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("new processor returned error: %v", err)
	}

	if _, err := processor.ProcessReady(context.Background()); err != nil {
		t.Fatalf("process ready returned error: %v", err)
	}

	failedPath := filepath.Join(spoolDir, queueSubdirectory, failedSubdirectory, queueRecordFilename("evt-123"))
	payload, err := os.ReadFile(failedPath)
	if err != nil {
		t.Fatalf("expected failed record at %s: %v", failedPath, err)
	}

	var failed FailedJob
	if err := json.Unmarshal(payload, &failed); err != nil {
		t.Fatalf("decode failed record: %v", err)
	}
	if failed.FinalErrorCode != "print_failed" {
		t.Fatalf("unexpected final error code: %q", failed.FinalErrorCode)
	}

	readyJobs, err := store.ListReady(now.Add(time.Hour), 10)
	if err != nil {
		t.Fatalf("list ready returned error: %v", err)
	}
	if len(readyJobs) != 0 {
		t.Fatalf("expected pending record to be removed after terminal failure, got %d", len(readyJobs))
	}

	if _, err := os.Stat(store.pendingPath("evt-123")); !os.IsNotExist(err) {
		t.Fatalf("expected pending record to be moved away, stat err=%v", err)
	}
}

func TestProcessorDoesNotConsumeRetryBudgetOnCancellation(t *testing.T) {
	store := mustStore(t, t.TempDir())
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	_, _, err := store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("enqueue returned error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	processor, err := NewProcessor(ProcessorConfig{
		Store: store,
		Executor: fakeExecutor{execute: func(_ context.Context, _ jobexec.Command) jobexec.Result {
			cancel()
			return jobexec.Result{
				Outcome:      jobexec.OutcomeFailed,
				ErrorCode:    "download_failed",
				ErrorMessage: "context canceled",
			}
		}},
		RetryPolicy: RetryPolicy{MaxAttempts: 3, InitialDelay: time.Second, MaxDelay: time.Second, Multiplier: 2},
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("new processor returned error: %v", err)
	}

	processed, err := processor.ProcessReady(ctx)
	if err != nil {
		t.Fatalf("process ready returned error: %v", err)
	}
	if processed != 0 {
		t.Fatalf("expected canceled attempt to leave processed count at 0, got %d", processed)
	}

	queuedJob := readPendingJob(t, store, "evt-123")
	if queuedJob.AttemptCount != 0 {
		t.Fatalf("expected attempt count to remain 0 after cancellation, got %d", queuedJob.AttemptCount)
	}
	if queuedJob.LastErrorCode != "" || queuedJob.LastErrorMessage != "" {
		t.Fatalf("expected pending job to remain unchanged after cancellation, got code=%q message=%q", queuedJob.LastErrorCode, queuedJob.LastErrorMessage)
	}
}

func TestProcessorDeletesPrintedJobEvenIfShutdownArrivesAfterExecute(t *testing.T) {
	store := mustStore(t, t.TempDir())
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	_, _, err := store.Enqueue(buildCommand(), now)
	if err != nil {
		t.Fatalf("enqueue returned error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	processor, err := NewProcessor(ProcessorConfig{
		Store: store,
		Executor: fakeExecutor{execute: func(_ context.Context, _ jobexec.Command) jobexec.Result {
			cancel()
			return jobexec.Result{
				Outcome:  jobexec.OutcomePrinted,
				LPOutput: "request id is printer-01-42",
			}
		}},
		RetryPolicy: RetryPolicy{MaxAttempts: 3, InitialDelay: time.Second, MaxDelay: time.Second, Multiplier: 2},
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("new processor returned error: %v", err)
	}

	processed, err := processor.ProcessReady(ctx)
	if err != nil {
		t.Fatalf("process ready returned error: %v", err)
	}
	if processed != 1 {
		t.Fatalf("expected printed job to count as processed, got %d", processed)
	}

	if _, err := os.Stat(store.pendingPath("evt-123")); !os.IsNotExist(err) {
		t.Fatalf("expected printed job to be removed from pending queue, stat err=%v", err)
	}
}

func TestProcessorSchedulesRetriesFromPerJobFailureTime(t *testing.T) {
	store := mustStore(t, t.TempDir())
	initialTime := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	firstFailureTime := initialTime.Add(2 * time.Second)
	secondFailureTime := initialTime.Add(9 * time.Second)

	_, _, err := store.Enqueue(jobexec.Command{
		EventID:   "evt-1",
		TraceID:   "trace-1",
		JobID:     "job-1",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/1.pdf",
	}, initialTime)
	if err != nil {
		t.Fatalf("enqueue evt-1 returned error: %v", err)
	}

	_, _, err = store.Enqueue(jobexec.Command{
		EventID:   "evt-2",
		TraceID:   "trace-2",
		JobID:     "job-2",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/2.pdf",
	}, initialTime)
	if err != nil {
		t.Fatalf("enqueue evt-2 returned error: %v", err)
	}

	nowValues := []time.Time{initialTime, firstFailureTime, secondFailureTime}
	nowIndex := 0
	processor, err := NewProcessor(ProcessorConfig{
		Store: store,
		Executor: fakeExecutor{execute: func(_ context.Context, _ jobexec.Command) jobexec.Result {
			return jobexec.Result{
				Outcome:      jobexec.OutcomeFailed,
				ErrorCode:    "print_failed",
				ErrorMessage: "busy",
			}
		}},
		RetryPolicy: RetryPolicy{MaxAttempts: 3, InitialDelay: 5 * time.Second, MaxDelay: 30 * time.Second, Multiplier: 2},
		Now: func() time.Time {
			value := nowValues[nowIndex]
			if nowIndex < len(nowValues)-1 {
				nowIndex++
			}
			return value
		},
	})
	if err != nil {
		t.Fatalf("new processor returned error: %v", err)
	}

	if _, err := processor.ProcessReady(context.Background()); err != nil {
		t.Fatalf("process ready returned error: %v", err)
	}

	firstQueuedJob := readPendingJob(t, store, "evt-1")
	if !firstQueuedJob.NextAttemptAt.Equal(firstFailureTime.Add(5 * time.Second)) {
		t.Fatalf("expected first retry at %s, got %s", firstFailureTime.Add(5*time.Second), firstQueuedJob.NextAttemptAt)
	}

	secondQueuedJob := readPendingJob(t, store, "evt-2")
	if !secondQueuedJob.NextAttemptAt.Equal(secondFailureTime.Add(5 * time.Second)) {
		t.Fatalf("expected second retry at %s, got %s", secondFailureTime.Add(5*time.Second), secondQueuedJob.NextAttemptAt)
	}
}

func mustStore(t *testing.T, spoolDir string) *Store {
	t.Helper()

	store, err := NewStore(spoolDir)
	if err != nil {
		t.Fatalf("new store returned error: %v", err)
	}

	return store
}

func readPendingJob(t *testing.T, store *Store, eventID string) QueuedJob {
	t.Helper()

	payload, err := os.ReadFile(store.pendingPath(eventID))
	if err != nil {
		t.Fatalf("read pending job %q: %v", eventID, err)
	}

	var queuedJob QueuedJob
	if err := json.Unmarshal(payload, &queuedJob); err != nil {
		t.Fatalf("decode pending job %q: %v", eventID, err)
	}

	return queuedJob
}

func buildCommand() jobexec.Command {
	return jobexec.Command{
		EventID:   "evt-123",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/label.pdf",
	}
}

type fakeExecutor struct {
	execute func(context.Context, jobexec.Command) jobexec.Result
}

func (executor fakeExecutor) Execute(ctx context.Context, command jobexec.Command) jobexec.Result {
	return executor.execute(ctx, command)
}
