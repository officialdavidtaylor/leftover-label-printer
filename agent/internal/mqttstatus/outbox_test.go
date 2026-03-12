package mqttstatus

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFileOutboxEnqueueAndDrainPublishesInOrder(t *testing.T) {
	spoolDir := t.TempDir()
	outbox, err := NewFileOutbox(spoolDir)
	if err != nil {
		t.Fatalf("new outbox: %v", err)
	}

	firstPayload := PrintJobOutcomePayload{
		SchemaVersion: "1.0.0",
		Type:          "printed",
		EventID:       "event-1",
		TraceID:       "trace-1",
		JobID:         "job-1",
		PrinterID:     "printer-1",
		Outcome:       "printed",
		OccurredAt:    "2026-03-12T00:00:00Z",
	}
	secondPayload := PrintJobOutcomePayload{
		SchemaVersion: "1.0.0",
		Type:          "failed",
		EventID:       "event-2",
		TraceID:       "trace-2",
		JobID:         "job-2",
		PrinterID:     "printer-1",
		Outcome:       "failed",
		OccurredAt:    "2026-03-12T00:00:01Z",
		ErrorCode:     "print_failed",
		ErrorMessage:  "lp exit status 1",
	}

	if err := outbox.Enqueue(secondPayload); err != nil {
		t.Fatalf("enqueue second payload: %v", err)
	}
	if err := outbox.Enqueue(firstPayload); err != nil {
		t.Fatalf("enqueue first payload: %v", err)
	}

	publisher := &capturePayloadPublisher{}
	publishedCount, err := outbox.Drain(context.Background(), publisher)
	if err != nil {
		t.Fatalf("drain outbox: %v", err)
	}

	if publishedCount != 2 {
		t.Fatalf("expected 2 published payloads, got %d", publishedCount)
	}
	if len(publisher.payloads) != 2 {
		t.Fatalf("expected 2 captured payloads, got %d", len(publisher.payloads))
	}
	if publisher.payloads[0].EventID != "event-1" || publisher.payloads[1].EventID != "event-2" {
		t.Fatalf("unexpected publish order: %+v", publisher.payloads)
	}

	entries, err := os.ReadDir(filepath.Join(spoolDir, outboxDirectoryName))
	if err != nil {
		t.Fatalf("read outbox directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected outbox to be empty, found %d entries", len(entries))
	}
}

func TestFileOutboxRetainsPendingEntryOnPublishFailure(t *testing.T) {
	spoolDir := t.TempDir()
	outbox, err := NewFileOutbox(spoolDir)
	if err != nil {
		t.Fatalf("new outbox: %v", err)
	}

	payload := PrintJobOutcomePayload{
		SchemaVersion: "1.0.0",
		Type:          "printed",
		EventID:       "event-1",
		TraceID:       "trace-1",
		JobID:         "job-1",
		PrinterID:     "printer-1",
		Outcome:       "printed",
		OccurredAt:    "2026-03-12T00:00:00Z",
	}

	if err := outbox.Enqueue(payload); err != nil {
		t.Fatalf("enqueue payload: %v", err)
	}

	publisher := &capturePayloadPublisher{
		errors: []error{errors.New("broker unavailable")},
	}
	publishedCount, err := outbox.Drain(context.Background(), publisher)
	if err == nil {
		t.Fatal("expected drain error")
	}
	if publishedCount != 0 {
		t.Fatalf("expected zero published payloads, got %d", publishedCount)
	}

	entries, err := os.ReadDir(filepath.Join(spoolDir, outboxDirectoryName))
	if err != nil {
		t.Fatalf("read outbox directory: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one retained outbox file, got %d", len(entries))
	}
}

type capturePayloadPublisher struct {
	payloads []PrintJobOutcomePayload
	errors   []error
}

func (publisher *capturePayloadPublisher) PublishPayload(
	_ context.Context,
	payload PrintJobOutcomePayload,
) (PublishPrintJobOutcomeResult, error) {
	publisher.payloads = append(publisher.payloads, payload)

	if len(publisher.errors) != 0 {
		err := publisher.errors[0]
		publisher.errors = publisher.errors[1:]
		if err != nil {
			return PublishPrintJobOutcomeResult{}, err
		}
	}

	return PublishPrintJobOutcomeResult{
		Topic:   "printers/" + payload.PrinterID + "/status",
		QoS:     1,
		Payload: payload,
	}, nil
}
