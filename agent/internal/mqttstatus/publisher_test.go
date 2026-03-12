package mqttstatus

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
)

func TestPublishPrintJobOutcomePublishesTerminalPrintedPayload(t *testing.T) {
	var (
		publishedTopic   string
		publishedPayload []byte
		connectCalls     int
		closeCalls       int
	)

	client := fakeClient{
		connect: func(context.Context) (mqttconsume.Session, error) {
			connectCalls++
			return fakeSession{
				publish: func(_ context.Context, topic string, payload []byte) error {
					publishedTopic = topic
					publishedPayload = append([]byte(nil), payload...)
					return nil
				},
				close: func() error {
					closeCalls++
					return nil
				},
			}, nil
		},
	}

	publisher, err := NewPublisher(Config{
		Client:        client,
		Now:           func() time.Time { return time.Date(2026, 3, 5, 12, 0, 0, 0, time.UTC) },
		CreateEventID: func() string { return "event-outcome-1" },
	})
	if err != nil {
		t.Fatalf("new publisher: %v", err)
	}

	result, err := publisher.PublishPrintJobOutcome(context.Background(), PublishPrintJobOutcomeInput{
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		Outcome:   jobexec.OutcomePrinted,
	})
	if err != nil {
		t.Fatalf("publish outcome: %v", err)
	}

	if connectCalls != 1 {
		t.Fatalf("expected one connect call, got %d", connectCalls)
	}
	if closeCalls != 1 {
		t.Fatalf("expected one close call, got %d", closeCalls)
	}
	if publishedTopic != "printers/printer-01/status" {
		t.Fatalf("unexpected publish topic: %s", publishedTopic)
	}

	var payload PrintJobOutcomePayload
	if err := json.Unmarshal(publishedPayload, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}

	if payload.SchemaVersion != "1.0.0" {
		t.Fatalf("unexpected schema version: %s", payload.SchemaVersion)
	}
	if payload.Type != "printed" {
		t.Fatalf("unexpected type: %s", payload.Type)
	}
	if payload.EventID != "event-outcome-1" {
		t.Fatalf("unexpected event id: %s", payload.EventID)
	}
	if payload.TraceID != "trace-123" || payload.JobID != "job-123" || payload.PrinterID != "printer-01" {
		t.Fatalf("unexpected metadata payload: %+v", payload)
	}
	if payload.Outcome != "printed" {
		t.Fatalf("unexpected outcome: %s", payload.Outcome)
	}
	if payload.OccurredAt != "2026-03-05T12:00:00Z" {
		t.Fatalf("unexpected occurredAt: %s", payload.OccurredAt)
	}
	if payload.ErrorCode != "" || payload.ErrorMessage != "" {
		t.Fatalf("did not expect error fields for printed payload: %+v", payload)
	}

	if result.QoS != 1 || result.Topic != "printers/printer-01/status" || result.Payload.Type != "printed" {
		t.Fatalf("unexpected publish result: %+v", result)
	}
}

func TestPublishPrintJobOutcomeIncludesFailureErrorDetails(t *testing.T) {
	var publishedPayload []byte

	client := fakeClient{
		connect: func(context.Context) (mqttconsume.Session, error) {
			return fakeSession{
				publish: func(_ context.Context, _ string, payload []byte) error {
					publishedPayload = append([]byte(nil), payload...)
					return nil
				},
				close: func() error { return nil },
			}, nil
		},
	}

	publisher, err := NewPublisher(Config{
		Client:        client,
		Now:           func() time.Time { return time.Date(2026, 3, 5, 12, 30, 0, 123000000, time.UTC) },
		CreateEventID: func() string { return "event-outcome-2" },
	})
	if err != nil {
		t.Fatalf("new publisher: %v", err)
	}

	_, err = publisher.PublishPrintJobOutcome(context.Background(), PublishPrintJobOutcomeInput{
		TraceID:      "trace-2",
		JobID:        "job-2",
		PrinterID:    "printer-2",
		Outcome:      jobexec.OutcomeFailed,
		ErrorCode:    "print_failed",
		ErrorMessage: "lp command failed: exit status 1",
	})
	if err != nil {
		t.Fatalf("publish outcome: %v", err)
	}

	var payload PrintJobOutcomePayload
	if err := json.Unmarshal(publishedPayload, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}

	if payload.Type != "failed" || payload.Outcome != "failed" {
		t.Fatalf("unexpected failure markers: %+v", payload)
	}
	if payload.ErrorCode != "print_failed" || payload.ErrorMessage == "" {
		t.Fatalf("missing failure details: %+v", payload)
	}
}

func TestPublishPrintJobOutcomeValidatesFailureFields(t *testing.T) {
	client := fakeClient{
		connect: func(context.Context) (mqttconsume.Session, error) {
			t.Fatal("connect should not be called for invalid input")
			return nil, nil
		},
	}

	publisher, err := NewPublisher(Config{
		Client:        client,
		CreateEventID: func() string { return "event-outcome-3" },
	})
	if err != nil {
		t.Fatalf("new publisher: %v", err)
	}

	_, err = publisher.PublishPrintJobOutcome(context.Background(), PublishPrintJobOutcomeInput{
		TraceID:   "trace-3",
		JobID:     "job-3",
		PrinterID: "printer-3",
		Outcome:   jobexec.OutcomeFailed,
	})
	if err == nil {
		t.Fatal("expected validation error for missing failure details")
	}
}

func TestPublishPrintJobOutcomeWrapsConnectError(t *testing.T) {
	client := fakeClient{
		connect: func(context.Context) (mqttconsume.Session, error) {
			return nil, errors.New("dial tcp timeout")
		},
	}

	publisher, err := NewPublisher(Config{Client: client})
	if err != nil {
		t.Fatalf("new publisher: %v", err)
	}

	_, err = publisher.PublishPrintJobOutcome(context.Background(), PublishPrintJobOutcomeInput{
		TraceID:   "trace-4",
		JobID:     "job-4",
		PrinterID: "printer-4",
		Outcome:   jobexec.OutcomePrinted,
	})
	if err == nil {
		t.Fatal("expected connect error")
	}
}

type fakeClient struct {
	connect func(context.Context) (mqttconsume.Session, error)
}

func (client fakeClient) Connect(ctx context.Context) (mqttconsume.Session, error) {
	return client.connect(ctx)
}

type fakeSession struct {
	publish func(context.Context, string, []byte) error
	close   func() error
}

func (session fakeSession) Subscribe(context.Context, string, func(context.Context, []byte) error) error {
	return nil
}

func (session fakeSession) Publish(ctx context.Context, topic string, payload []byte) error {
	return session.publish(ctx, topic, payload)
}

func (session fakeSession) WaitForDisconnect(context.Context) error {
	return nil
}

func (session fakeSession) Close() error {
	return session.close()
}
