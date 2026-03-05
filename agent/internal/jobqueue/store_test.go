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

	if err := store.WriteFailed(FailedJob{
		QueuedJob: QueuedJob{
			EventID:       "event-failed",
			TraceID:       "trace-123",
			JobID:         "job-123",
			PrinterID:     "printer-01",
			ObjectURL:     "https://example.com/label.pdf",
			QueuedAt:      now,
			NextAttemptAt: now,
		},
		FinalErrorCode:    "print_failed",
		FinalErrorMessage: "lp command failed",
		FailedAt:          now,
	}); err != nil {
		t.Fatalf("write failed returned error: %v", err)
	}

	_, created, err = store.Enqueue(jobexec.Command{
		EventID:   "event-failed",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/label.pdf",
	}, now)
	if err != nil {
		t.Fatalf("enqueue after failed returned error: %v", err)
	}
	if created {
		t.Fatal("expected failed event id to remain deduped")
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

	failedPath := filepath.Join(spoolDir, queueSubdirectory, failedSubdirectory, "evt-123.json")
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
}

func mustStore(t *testing.T, spoolDir string) *Store {
	t.Helper()

	store, err := NewStore(spoolDir)
	if err != nil {
		t.Fatalf("new store returned error: %v", err)
	}

	return store
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
