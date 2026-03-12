package main

import (
	"context"
	"errors"
	"testing"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttstatus"
)

func TestBuildPrintJobCommandHandlerExecutesQueuesAndDrainsOutcome(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{
			Outcome:      jobexec.OutcomeFailed,
			ErrorCode:    "download_failed",
			ErrorMessage: "network timeout",
		},
	}
	fakePublisher := &captureOutcomePublisher{
		payload: mqttstatus.PrintJobOutcomePayload{
			SchemaVersion: "1.0.0",
			Type:          "failed",
			EventID:       "outcome-event-1",
			TraceID:       "trace-123",
			JobID:         "job-123",
			PrinterID:     "printer-01",
			Outcome:       "failed",
			OccurredAt:    "2026-03-05T00:00:00Z",
			ErrorCode:     "download_failed",
			ErrorMessage:  "network timeout",
		},
	}
	fakeOutbox := &captureOutcomeOutbox{}

	handler := buildPrintJobCommandHandler(fakeExecutor, fakePublisher, fakeOutbox)
	err := handler(context.Background(), mqttconsume.PrintJobCommand{
		EventID:   "dispatch-event-123",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	})
	if err != nil {
		t.Fatalf("expected nil handler error, got %v", err)
	}

	if fakeExecutor.calls != 1 {
		t.Fatalf("expected one executor call, got %d", fakeExecutor.calls)
	}
	if fakePublisher.buildCalls != 1 {
		t.Fatalf("expected one build call, got %d", fakePublisher.buildCalls)
	}
	if fakePublisher.publishCalls != 1 {
		t.Fatalf("expected one publish call, got %d", fakePublisher.publishCalls)
	}
	if len(fakeOutbox.enqueued) != 1 {
		t.Fatalf("expected one enqueued payload, got %d", len(fakeOutbox.enqueued))
	}
	if fakeOutbox.drainCalls != 1 {
		t.Fatalf("expected one drain call, got %d", fakeOutbox.drainCalls)
	}
	if fakeOutbox.enqueued[0].EventID != "outcome-event-1" {
		t.Fatalf("unexpected enqueued payload: %+v", fakeOutbox.enqueued[0])
	}
	if fakePublisher.published[0].EventID != "outcome-event-1" {
		t.Fatalf("unexpected published payload: %+v", fakePublisher.published[0])
	}
}

func TestBuildPrintJobCommandHandlerReturnsNilWhenOutcomeQueuedButPublishFails(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{
			Outcome: jobexec.OutcomePrinted,
		},
	}
	fakePublisher := &captureOutcomePublisher{
		payload: mqttstatus.PrintJobOutcomePayload{
			SchemaVersion: "1.0.0",
			Type:          "printed",
			EventID:       "outcome-event-2",
			TraceID:       "trace-2",
			JobID:         "job-2",
			PrinterID:     "printer-01",
			Outcome:       "printed",
			OccurredAt:    "2026-03-05T01:00:00Z",
		},
		errors: []error{errors.New("broker unavailable")},
	}
	fakeOutbox := &captureOutcomeOutbox{}

	handler := buildPrintJobCommandHandler(fakeExecutor, fakePublisher, fakeOutbox)
	err := handler(context.Background(), mqttconsume.PrintJobCommand{
		EventID:   "dispatch-event-2",
		TraceID:   "trace-2",
		JobID:     "job-2",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	})
	if err != nil {
		t.Fatalf("expected nil handler error after durable queue, got %v", err)
	}

	if fakeExecutor.calls != 1 {
		t.Fatalf("expected one executor call, got %d", fakeExecutor.calls)
	}
	if fakeOutbox.drainCalls != 1 {
		t.Fatalf("expected one drain call, got %d", fakeOutbox.drainCalls)
	}
	if len(fakeOutbox.enqueued) != 1 {
		t.Fatalf("expected one queued payload, got %d", len(fakeOutbox.enqueued))
	}
}

func TestBuildPrintJobCommandHandlerReturnsErrorWhenQueueWriteFails(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{
			Outcome: jobexec.OutcomePrinted,
		},
	}
	fakePublisher := &captureOutcomePublisher{
		payload: mqttstatus.PrintJobOutcomePayload{
			SchemaVersion: "1.0.0",
			Type:          "printed",
			EventID:       "outcome-event-3",
			TraceID:       "trace-3",
			JobID:         "job-3",
			PrinterID:     "printer-01",
			Outcome:       "printed",
			OccurredAt:    "2026-03-05T02:00:00Z",
		},
	}
	fakeOutbox := &captureOutcomeOutbox{
		enqueueErr: errors.New("disk full"),
	}

	handler := buildPrintJobCommandHandler(fakeExecutor, fakePublisher, fakeOutbox)
	err := handler(context.Background(), mqttconsume.PrintJobCommand{
		EventID:   "dispatch-event-3",
		TraceID:   "trace-3",
		JobID:     "job-3",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	})
	if err == nil {
		t.Fatal("expected queue write error")
	}

	if fakeOutbox.drainCalls != 0 {
		t.Fatalf("expected no drain attempts after enqueue failure, got %d", fakeOutbox.drainCalls)
	}
	if fakePublisher.publishCalls != 0 {
		t.Fatalf("expected no publish attempts after enqueue failure, got %d", fakePublisher.publishCalls)
	}
}

type captureExecutor struct {
	command jobexec.Command
	result  jobexec.Result
	calls   int
}

func (executor *captureExecutor) Execute(_ context.Context, command jobexec.Command) jobexec.Result {
	executor.calls++
	executor.command = command
	return executor.result
}

type captureOutcomePublisher struct {
	payload      mqttstatus.PrintJobOutcomePayload
	buildInput   mqttstatus.PublishPrintJobOutcomeInput
	buildCalls   int
	publishCalls int
	published    []mqttstatus.PrintJobOutcomePayload
	errors       []error
}

func (publisher *captureOutcomePublisher) BuildPrintJobOutcomePayload(
	input mqttstatus.PublishPrintJobOutcomeInput,
) (mqttstatus.PrintJobOutcomePayload, error) {
	publisher.buildCalls++
	publisher.buildInput = input
	return publisher.payload, nil
}

func (publisher *captureOutcomePublisher) PublishPayload(
	_ context.Context,
	payload mqttstatus.PrintJobOutcomePayload,
) (mqttstatus.PublishPrintJobOutcomeResult, error) {
	publisher.publishCalls++
	publisher.published = append(publisher.published, payload)

	if len(publisher.errors) != 0 {
		err := publisher.errors[0]
		publisher.errors = publisher.errors[1:]
		if err != nil {
			return mqttstatus.PublishPrintJobOutcomeResult{}, err
		}
	}

	return mqttstatus.PublishPrintJobOutcomeResult{
		Topic:   "printers/" + payload.PrinterID + "/status",
		QoS:     1,
		Payload: payload,
	}, nil
}

type captureOutcomeOutbox struct {
	enqueued   []mqttstatus.PrintJobOutcomePayload
	enqueueErr error
	drainCalls int
}

func (outbox *captureOutcomeOutbox) Enqueue(payload mqttstatus.PrintJobOutcomePayload) error {
	if outbox.enqueueErr != nil {
		return outbox.enqueueErr
	}

	outbox.enqueued = append(outbox.enqueued, payload)
	return nil
}

func (outbox *captureOutcomeOutbox) Drain(
	ctx context.Context,
	publisher mqttstatus.OutcomePayloadPublisher,
) (int, error) {
	outbox.drainCalls++

	publishedCount := 0
	for _, payload := range outbox.enqueued {
		if _, err := publisher.PublishPayload(ctx, payload); err != nil {
			return publishedCount, err
		}
		publishedCount++
	}

	return publishedCount, nil
}
