package main

import (
	"context"
	"testing"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
)

func TestBuildPrintJobCommandHandlerAlwaysReturnsNilAfterExecution(t *testing.T) {
	fakeExecutor := &captureExecutor{
		result: jobexec.Result{
			Outcome:      jobexec.OutcomeFailed,
			ErrorCode:    "download_failed",
			ErrorMessage: "network timeout",
		},
	}

	handler := buildPrintJobCommandHandler(fakeExecutor)
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
}

type captureExecutor struct {
	command jobexec.Command
	result  jobexec.Result
}

func (executor *captureExecutor) Execute(_ context.Context, command jobexec.Command) jobexec.Result {
	executor.command = command
	return executor.result
}
