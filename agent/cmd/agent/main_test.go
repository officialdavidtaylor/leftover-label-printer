package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobqueue"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
)

func TestBuildPrintJobCommandHandlerEnqueuesAndSignalsWake(t *testing.T) {
	now := time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC)
	fakeQueue := &captureQueue{
		queuedJob: jobqueue.QueuedJob{EventID: "event-123"},
		created:   true,
	}
	wake := make(chan struct{}, 1)

	handler := buildPrintJobCommandHandler(fakeQueue, wake, noopQueueLogger{}, func() time.Time { return now })
	err := handler(context.Background(), mqttconsume.PrintJobCommand{
		EventID:   "event-123",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	})
	if err != nil {
		t.Fatalf("expected nil handler error, got %v", err)
	}

	if fakeQueue.command.EventID != "event-123" {
		t.Fatalf("expected event id propagation, got %q", fakeQueue.command.EventID)
	}
	if fakeQueue.command.TraceID != "trace-123" {
		t.Fatalf("expected trace id propagation, got %q", fakeQueue.command.TraceID)
	}
	if fakeQueue.command.JobID != "job-123" {
		t.Fatalf("expected job id propagation, got %q", fakeQueue.command.JobID)
	}
	if fakeQueue.command.PrinterID != "printer-01" {
		t.Fatalf("expected printer id propagation, got %q", fakeQueue.command.PrinterID)
	}
	if fakeQueue.command.ObjectURL != "https://example.com/file.pdf" {
		t.Fatalf("expected object url propagation, got %q", fakeQueue.command.ObjectURL)
	}

	select {
	case <-wake:
	default:
		t.Fatal("expected queue wake signal")
	}
}

func TestBuildPrintJobCommandHandlerReturnsEnqueueError(t *testing.T) {
	fakeQueue := &captureQueue{
		err: errors.New("disk full"),
	}
	handler := buildPrintJobCommandHandler(fakeQueue, make(chan struct{}, 1), noopQueueLogger{}, time.Now)

	err := handler(context.Background(), mqttconsume.PrintJobCommand{
		EventID:   "event-123",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	})
	if err == nil {
		t.Fatal("expected enqueue error")
	}
}

type captureQueue struct {
	command   jobexec.Command
	now       time.Time
	queuedJob jobqueue.QueuedJob
	created   bool
	err       error
}

func (queue *captureQueue) Enqueue(command jobexec.Command, now time.Time) (jobqueue.QueuedJob, bool, error) {
	queue.command = command
	queue.now = now
	return queue.queuedJob, queue.created, queue.err
}

type noopQueueLogger struct{}

func (noopQueueLogger) Info(string, map[string]any) {}

func (noopQueueLogger) Warn(string, map[string]any) {}
