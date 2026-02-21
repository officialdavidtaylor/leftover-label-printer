package mqttconsume

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestPrinterJobTopic(t *testing.T) {
	topic, err := PrinterJobTopic("printer-01")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if topic != "printers/printer-01/jobs" {
		t.Fatalf("unexpected topic: %s", topic)
	}

	if _, err := PrinterJobTopic("   "); err == nil {
		t.Fatal("expected error for empty printerID")
	}
}

func TestConsumeLoopSubscribesAndProcessesMessages(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var (
		subscribeTopic string
		handler        func(context.Context, []byte) error
		callCount      int
		lastCommand    PrintJobCommand
		mu             sync.Mutex
	)

	client := fakeClient{
		connect: func(context.Context) (Session, error) {
			return fakeSession{
				subscribe: func(_ context.Context, topic string, h func(context.Context, []byte) error) error {
					subscribeTopic = topic
					handler = h
					return nil
				},
				waitForDisconnect: func(ctx context.Context) error {
					<-ctx.Done()
					return ctx.Err()
				},
				close: func() error { return nil },
			}, nil
		},
	}

	done := make(chan error, 1)
	go func() {
		done <- ConsumeLoop(ctx, Options{
			PrinterID: "printer-01",
			Client:    client,
			OnCommand: func(_ context.Context, command PrintJobCommand) error {
				mu.Lock()
				defer mu.Unlock()
				callCount++
				lastCommand = command
				return nil
			},
			Sleep: func(context.Context, time.Duration) error { return nil },
		})
	}()

	waitFor(t, func() bool { return handler != nil }, "message handler was not registered")
	if subscribeTopic != "printers/printer-01/jobs" {
		t.Fatalf("unexpected subscribe topic: %s", subscribeTopic)
	}

	payload, err := json.Marshal(buildCommand(map[string]string{
		"eventId": "evt-1",
		"jobId":   "job-1",
	}))
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if err := handler(context.Background(), payload); err != nil {
		t.Fatalf("handler returned unexpected error: %v", err)
	}

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return callCount == 1
	}, "command handler was not called")

	mu.Lock()
	if lastCommand.EventID != "evt-1" || lastCommand.JobID != "job-1" {
		t.Fatalf("unexpected command: %+v", lastCommand)
	}
	mu.Unlock()

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("consume loop returned error: %v", err)
	}
}

func TestConsumeLoopIgnoresDuplicateEventIDs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var (
		handler   func(context.Context, []byte) error
		callCount int
		mu        sync.Mutex
	)

	client := fakeClient{
		connect: func(context.Context) (Session, error) {
			return fakeSession{
				subscribe: func(_ context.Context, _ string, h func(context.Context, []byte) error) error {
					handler = h
					return nil
				},
				waitForDisconnect: func(ctx context.Context) error {
					<-ctx.Done()
					return ctx.Err()
				},
				close: func() error { return nil },
			}, nil
		},
	}

	done := make(chan error, 1)
	go func() {
		done <- ConsumeLoop(ctx, Options{
			PrinterID: "printer-dup",
			Client:    client,
			OnCommand: func(context.Context, PrintJobCommand) error {
				mu.Lock()
				defer mu.Unlock()
				callCount++
				return nil
			},
			Sleep: func(context.Context, time.Duration) error { return nil },
		})
	}()

	waitFor(t, func() bool { return handler != nil }, "message handler was not registered")

	payload, err := json.Marshal(buildCommand(map[string]string{
		"printerId": "printer-dup",
		"eventId":   "dup-event",
	}))
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if err := handler(context.Background(), payload); err != nil {
		t.Fatalf("first handler call failed: %v", err)
	}
	if err := handler(context.Background(), payload); err != nil {
		t.Fatalf("second handler call failed: %v", err)
	}

	mu.Lock()
	if callCount != 1 {
		mu.Unlock()
		t.Fatalf("expected one handler call, got %d", callCount)
	}
	mu.Unlock()

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("consume loop returned error: %v", err)
	}
}

func TestConsumeLoopRetriesConnectWithBackoff(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	connectAttempts := 0
	sleepDurations := make([]time.Duration, 0, 2)
	var mu sync.Mutex

	client := fakeClient{
		connect: func(context.Context) (Session, error) {
			connectAttempts++
			if connectAttempts < 3 {
				return nil, errors.New("connect failed")
			}

			return fakeSession{
				subscribe: func(context.Context, string, func(context.Context, []byte) error) error {
					return nil
				},
				waitForDisconnect: func(ctx context.Context) error {
					cancel()
					<-ctx.Done()
					return ctx.Err()
				},
				close: func() error { return nil },
			}, nil
		},
	}

	err := ConsumeLoop(ctx, Options{
		PrinterID: "printer-backoff",
		Client:    client,
		OnCommand: func(context.Context, PrintJobCommand) error { return nil },
		Sleep: func(_ context.Context, delay time.Duration) error {
			mu.Lock()
			sleepDurations = append(sleepDurations, delay)
			mu.Unlock()
			return nil
		},
		Backoff: BackoffPolicy{
			InitialDelay: 100 * time.Millisecond,
			MaxDelay:     1 * time.Second,
			Multiplier:   2,
		},
	})
	if err != nil {
		t.Fatalf("consume loop returned error: %v", err)
	}

	if connectAttempts != 3 {
		t.Fatalf("expected 3 connect attempts, got %d", connectAttempts)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(sleepDurations) != 2 {
		t.Fatalf("expected 2 backoff sleeps, got %d", len(sleepDurations))
	}
	if sleepDurations[0] != 100*time.Millisecond || sleepDurations[1] != 200*time.Millisecond {
		t.Fatalf("unexpected backoff durations: %v", sleepDurations)
	}
}

func TestConsumeLoopReconnectsAfterDisconnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	connectAttempts := 0
	subscribeTopics := make([]string, 0, 2)
	sleepDurations := make([]time.Duration, 0, 1)
	var mu sync.Mutex

	client := fakeClient{
		connect: func(context.Context) (Session, error) {
			connectAttempts++
			if connectAttempts == 1 {
				return fakeSession{
					subscribe: func(_ context.Context, topic string, _ func(context.Context, []byte) error) error {
						mu.Lock()
						subscribeTopics = append(subscribeTopics, topic)
						mu.Unlock()
						return nil
					},
					waitForDisconnect: func(context.Context) error { return nil },
					close:             func() error { return nil },
				}, nil
			}

			return fakeSession{
				subscribe: func(_ context.Context, topic string, _ func(context.Context, []byte) error) error {
					mu.Lock()
					subscribeTopics = append(subscribeTopics, topic)
					mu.Unlock()
					return nil
				},
				waitForDisconnect: func(ctx context.Context) error {
					cancel()
					<-ctx.Done()
					return ctx.Err()
				},
				close: func() error { return nil },
			}, nil
		},
	}

	err := ConsumeLoop(ctx, Options{
		PrinterID: "printer-reconnect",
		Client:    client,
		OnCommand: func(context.Context, PrintJobCommand) error { return nil },
		Sleep: func(_ context.Context, delay time.Duration) error {
			mu.Lock()
			sleepDurations = append(sleepDurations, delay)
			mu.Unlock()
			return nil
		},
		Backoff: BackoffPolicy{
			InitialDelay: 50 * time.Millisecond,
			MaxDelay:     500 * time.Millisecond,
			Multiplier:   2,
		},
	})
	if err != nil {
		t.Fatalf("consume loop returned error: %v", err)
	}

	if connectAttempts != 2 {
		t.Fatalf("expected 2 connect attempts, got %d", connectAttempts)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(subscribeTopics) != 2 {
		t.Fatalf("expected 2 subscribe calls, got %d", len(subscribeTopics))
	}
	if subscribeTopics[0] != "printers/printer-reconnect/jobs" || subscribeTopics[1] != "printers/printer-reconnect/jobs" {
		t.Fatalf("unexpected subscribe topics: %v", subscribeTopics)
	}
	if len(sleepDurations) != 1 || sleepDurations[0] != 50*time.Millisecond {
		t.Fatalf("unexpected sleep durations: %v", sleepDurations)
	}
}

type fakeClient struct {
	connect func(context.Context) (Session, error)
}

func (client fakeClient) Connect(ctx context.Context) (Session, error) {
	return client.connect(ctx)
}

type fakeSession struct {
	subscribe         func(context.Context, string, func(context.Context, []byte) error) error
	waitForDisconnect func(context.Context) error
	close             func() error
}

func (session fakeSession) Subscribe(
	ctx context.Context,
	topic string,
	handler func(context.Context, []byte) error,
) error {
	return session.subscribe(ctx, topic, handler)
}

func (session fakeSession) WaitForDisconnect(ctx context.Context) error {
	return session.waitForDisconnect(ctx)
}

func (session fakeSession) Close() error {
	return session.close()
}

func buildCommand(overrides map[string]string) map[string]string {
	command := map[string]string{
		"schemaVersion": "1.0.0",
		"type":          "print_job_dispatch",
		"eventId":       "evt-default",
		"traceId":       "trace-default",
		"jobId":         "job-default",
		"printerId":     "printer-01",
		"objectUrl":     "https://example.com/object.pdf",
		"issuedAt":      "2026-02-21T00:00:00Z",
	}

	for key, value := range overrides {
		command[key] = value
	}

	return command
}

func waitFor(t *testing.T, condition func() bool, message string) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal(message)
}
