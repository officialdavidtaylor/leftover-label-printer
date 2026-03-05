package main

import (
	"context"
	"errors"
	"testing"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttstatus"
)

func TestBuildPrintJobCommandHandlerExecutesAndPublishesOutcome(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{
			Outcome:      jobexec.OutcomeFailed,
			ErrorCode:    "download_failed",
			ErrorMessage: "network timeout",
		},
	}
	fakePublisher := &captureOutcomePublisher{
		result: mqttstatus.PublishPrintJobOutcomeResult{
			Topic: "printers/printer-01/status",
			Payload: mqttstatus.PrintJobOutcomePayload{
				EventID:    "outcome-event-1",
				OccurredAt: "2026-03-05T00:00:00Z",
			},
		},
	}

	handler := buildPrintJobCommandHandler(fakeExecutor, fakePublisher)
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

	if fakeExecutor.command.EventID != "event-123" {
		t.Fatalf("expected event id propagation, got %q", fakeExecutor.command.EventID)
	}
	if fakeExecutor.command.TraceID != "trace-123" {
		t.Fatalf("expected trace id propagation, got %q", fakeExecutor.command.TraceID)
	}
	if fakeExecutor.command.JobID != "job-123" {
		t.Fatalf("expected job id propagation, got %q", fakeExecutor.command.JobID)
	}
	if fakeExecutor.command.PrinterID != "printer-01" {
		t.Fatalf("expected printer id propagation, got %q", fakeExecutor.command.PrinterID)
	}
	if fakeExecutor.command.ObjectURL != "https://example.com/file.pdf" {
		t.Fatalf("expected object url propagation, got %q", fakeExecutor.command.ObjectURL)
	}

	if fakePublisher.input.TraceID != "trace-123" {
		t.Fatalf("expected trace id propagation to publisher, got %q", fakePublisher.input.TraceID)
	}
	if fakePublisher.input.JobID != "job-123" {
		t.Fatalf("expected job id propagation to publisher, got %q", fakePublisher.input.JobID)
	}
	if fakePublisher.input.PrinterID != "printer-01" {
		t.Fatalf("expected printer id propagation to publisher, got %q", fakePublisher.input.PrinterID)
	}
	if fakePublisher.input.Outcome != jobexec.OutcomeFailed {
		t.Fatalf("expected failed outcome propagation to publisher, got %q", fakePublisher.input.Outcome)
	}
	if fakePublisher.input.ErrorCode != "download_failed" {
		t.Fatalf("expected error code propagation, got %q", fakePublisher.input.ErrorCode)
	}
	if fakePublisher.input.ErrorMessage != "network timeout" {
		t.Fatalf("expected error message propagation, got %q", fakePublisher.input.ErrorMessage)
	}
	if fakePublisher.calls != 1 {
		t.Fatalf("expected one publish call, got %d", fakePublisher.calls)
	}
}

func TestBuildPrintJobCommandHandlerCachesExecutionOnPublishFailure(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{
			Outcome: jobexec.OutcomePrinted,
		},
	}
	fakePublisher := &captureOutcomePublisher{
		errors: []error{
			errors.New("publish failed"),
			nil,
		},
		result: mqttstatus.PublishPrintJobOutcomeResult{
			Topic: "printers/printer-01/status",
			Payload: mqttstatus.PrintJobOutcomePayload{
				EventID:    "outcome-event-2",
				OccurredAt: "2026-03-05T01:00:00Z",
			},
		},
	}

	handler := buildPrintJobCommandHandler(fakeExecutor, fakePublisher)
	command := mqttconsume.PrintJobCommand{
		EventID:   "event-duplicate-safe",
		TraceID:   "trace-dup",
		JobID:     "job-dup",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	}

	if err := handler(context.Background(), command); err == nil {
		t.Fatal("expected publish error on first attempt")
	}

	if err := handler(context.Background(), command); err != nil {
		t.Fatalf("expected second attempt to succeed, got %v", err)
	}

	if fakeExecutor.calls != 1 {
		t.Fatalf("expected executor to run once, got %d calls", fakeExecutor.calls)
	}
	if fakePublisher.calls != 2 {
		t.Fatalf("expected publisher to run twice, got %d calls", fakePublisher.calls)
	}
}

func TestBuildPrintJobCommandHandlerReturnsPublisherError(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{Outcome: jobexec.OutcomePrinted},
	}
	fakePublisher := &captureOutcomePublisher{
		errors: []error{errors.New("broker unavailable")},
	}

	handler := buildPrintJobCommandHandler(fakeExecutor, fakePublisher)
	err := handler(context.Background(), mqttconsume.PrintJobCommand{
		EventID:   "event-err",
		TraceID:   "trace-err",
		JobID:     "job-err",
		PrinterID: "printer-01",
		ObjectURL: "https://example.com/file.pdf",
	})
	if err == nil {
		t.Fatal("expected publisher error")
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
	input  mqttstatus.PublishPrintJobOutcomeInput
	result mqttstatus.PublishPrintJobOutcomeResult
	errors []error
	calls  int
}

func (publisher *captureOutcomePublisher) PublishPrintJobOutcome(
	_ context.Context,
	input mqttstatus.PublishPrintJobOutcomeInput,
) (mqttstatus.PublishPrintJobOutcomeResult, error) {
	publisher.calls++
	publisher.input = input

	if len(publisher.errors) == 0 {
		return publisher.result, nil
	}

	err := publisher.errors[0]
	publisher.errors = publisher.errors[1:]
	if err != nil {
		return mqttstatus.PublishPrintJobOutcomeResult{}, err
	}

	return publisher.result, nil
}
