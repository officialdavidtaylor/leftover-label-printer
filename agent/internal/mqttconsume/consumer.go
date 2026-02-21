package mqttconsume

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var schemaVersionPattern = regexp.MustCompile(`^1\.[0-9]+\.[0-9]+$`)

const (
	defaultInitialBackoffDelay = 500 * time.Millisecond
	defaultMaxBackoffDelay     = 10 * time.Second
	defaultBackoffMultiplier   = 2.0
	defaultDedupeCacheSize     = 2048
)

// PrintJobCommand matches the backend dispatch payload contract.
type PrintJobCommand struct {
	SchemaVersion string `json:"schemaVersion"`
	Type          string `json:"type"`
	EventID       string `json:"eventId"`
	TraceID       string `json:"traceId"`
	JobID         string `json:"jobId"`
	PrinterID     string `json:"printerId"`
	ObjectURL     string `json:"objectUrl"`
	IssuedAt      string `json:"issuedAt"`
}

// Session represents a connected MQTT session.
type Session interface {
	Subscribe(ctx context.Context, topic string, handler func(context.Context, []byte) error) error
	WaitForDisconnect(ctx context.Context) error
	Close() error
}

// Client creates MQTT sessions.
type Client interface {
	Connect(ctx context.Context) (Session, error)
}

// Logger is intentionally small to keep the consumer package infrastructure-neutral.
type Logger interface {
	Info(event string, fields map[string]any)
	Warn(event string, fields map[string]any)
}

// BackoffPolicy controls reconnect timing after connect/disconnect failures.
type BackoffPolicy struct {
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Multiplier   float64
}

// Options controls consume loop behavior.
type Options struct {
	PrinterID            string
	Client               Client
	OnCommand            func(context.Context, PrintJobCommand) error
	Logger               Logger
	Sleep                func(context.Context, time.Duration) error
	Backoff              BackoffPolicy
	MaxProcessedEventIDs int
}

// PrinterJobTopic returns the backend command topic for one printer.
func PrinterJobTopic(printerID string) (string, error) {
	normalizedPrinterID := strings.TrimSpace(printerID)

	if normalizedPrinterID == "" {
		return "", errors.New("printerID must be a non-empty string")
	}

	return fmt.Sprintf("printers/%s/jobs", normalizedPrinterID), nil
}

// ConsumeLoop connects to the broker, subscribes to the printer command topic, and keeps reconnecting with backoff.
func ConsumeLoop(ctx context.Context, options Options) error {
	printerID := strings.TrimSpace(options.PrinterID)
	if printerID == "" {
		return errors.New("printerID must be a non-empty string")
	}

	if options.Client == nil {
		return errors.New("client is required")
	}

	if options.OnCommand == nil {
		return errors.New("onCommand is required")
	}

	topic, err := PrinterJobTopic(printerID)
	if err != nil {
		return err
	}

	sleep := options.Sleep
	if sleep == nil {
		sleep = sleepWithContext
	}

	backoff := newBackoffState(normalizeBackoffPolicy(options.Backoff))
	deduper := newMessageDeduper(resolveCacheSize(options.MaxProcessedEventIDs))

	for {
		if ctx.Err() != nil {
			return nil
		}

		session, connectErr := options.Client.Connect(ctx)
		if connectErr != nil {
			if isContextEnd(connectErr, ctx) {
				return nil
			}

			warn(options.Logger, "mqtt_connect_failed", map[string]any{
				"printerId": printerID,
				"topic":     topic,
				"error":     connectErr.Error(),
			})

			if err := sleep(ctx, backoff.NextDelay()); err != nil {
				if isContextEnd(err, ctx) {
					return nil
				}

				return err
			}

			continue
		}

		subscribeErr := session.Subscribe(ctx, topic, func(messageContext context.Context, payload []byte) error {
			command, ok := parsePrintJobCommand(payload, options.Logger)
			if !ok {
				return nil
			}

			if command.PrinterID != printerID {
				warn(options.Logger, "mqtt_command_printer_mismatch", map[string]any{
					"expectedPrinterId": printerID,
					"receivedPrinterId": command.PrinterID,
					"eventId":           command.EventID,
				})
				return nil
			}

			if !deduper.Start(command.EventID) {
				info(options.Logger, "mqtt_duplicate_command_ignored", map[string]any{
					"printerId": printerID,
					"eventId":   command.EventID,
					"jobId":     command.JobID,
				})
				return nil
			}

			processErr := options.OnCommand(messageContext, command)
			deduper.Finish(command.EventID, processErr == nil)

			if processErr != nil {
				warn(options.Logger, "mqtt_command_processing_failed", map[string]any{
					"printerId": printerID,
					"eventId":   command.EventID,
					"jobId":     command.JobID,
					"error":     processErr.Error(),
				})
			}

			return processErr
		})
		if subscribeErr != nil {
			_ = session.Close()

			if isContextEnd(subscribeErr, ctx) {
				return nil
			}

			warn(options.Logger, "mqtt_subscribe_failed", map[string]any{
				"printerId": printerID,
				"topic":     topic,
				"error":     subscribeErr.Error(),
			})

			if err := sleep(ctx, backoff.NextDelay()); err != nil {
				if isContextEnd(err, ctx) {
					return nil
				}

				return err
			}

			continue
		}

		backoff.Reset()
		info(options.Logger, "mqtt_consumer_subscribed", map[string]any{
			"printerId": printerID,
			"topic":     topic,
		})

		waitErr := session.WaitForDisconnect(ctx)
		closeErr := session.Close()
		if closeErr != nil {
			warn(options.Logger, "mqtt_close_failed", map[string]any{
				"printerId": printerID,
				"topic":     topic,
				"error":     closeErr.Error(),
			})
		}

		if isContextEnd(waitErr, ctx) {
			return nil
		}

		if waitErr == nil {
			warn(options.Logger, "mqtt_session_disconnected", map[string]any{
				"printerId": printerID,
				"topic":     topic,
			})
		} else {
			warn(options.Logger, "mqtt_consume_loop_error", map[string]any{
				"printerId": printerID,
				"topic":     topic,
				"error":     waitErr.Error(),
			})
		}

		delay := backoff.NextDelay()
		info(options.Logger, "mqtt_reconnect_scheduled", map[string]any{
			"printerId": printerID,
			"topic":     topic,
			"delayMs":   delay.Milliseconds(),
		})

		if err := sleep(ctx, delay); err != nil {
			if isContextEnd(err, ctx) {
				return nil
			}

			return err
		}
	}
}

func parsePrintJobCommand(payload []byte, logger Logger) (PrintJobCommand, bool) {
	var command PrintJobCommand

	if err := json.Unmarshal(payload, &command); err != nil {
		warn(logger, "mqtt_command_decode_failed", map[string]any{
			"error": err.Error(),
		})
		return PrintJobCommand{}, false
	}

	if err := validatePrintJobCommand(command); err != nil {
		warn(logger, "mqtt_command_schema_invalid", map[string]any{
			"error": err.Error(),
		})
		return PrintJobCommand{}, false
	}

	return command, true
}

func validatePrintJobCommand(command PrintJobCommand) error {
	if !schemaVersionPattern.MatchString(command.SchemaVersion) {
		return errors.New("schemaVersion must match major version 1 semver format")
	}

	if command.Type != "print_job_dispatch" {
		return errors.New("type must equal print_job_dispatch")
	}

	if strings.TrimSpace(command.EventID) == "" {
		return errors.New("eventId is required")
	}

	if strings.TrimSpace(command.TraceID) == "" {
		return errors.New("traceId is required")
	}

	if strings.TrimSpace(command.JobID) == "" {
		return errors.New("jobId is required")
	}

	if strings.TrimSpace(command.PrinterID) == "" {
		return errors.New("printerId is required")
	}

	if strings.TrimSpace(command.ObjectURL) == "" {
		return errors.New("objectUrl is required")
	}

	objectURL, err := url.ParseRequestURI(command.ObjectURL)
	if err != nil || objectURL.Scheme == "" || objectURL.Host == "" {
		return errors.New("objectUrl must be an absolute URI")
	}

	if strings.TrimSpace(command.IssuedAt) == "" {
		return errors.New("issuedAt is required")
	}

	if _, err := time.Parse(time.RFC3339, command.IssuedAt); err != nil {
		if _, secondErr := time.Parse(time.RFC3339Nano, command.IssuedAt); secondErr != nil {
			return errors.New("issuedAt must be a valid RFC3339 timestamp")
		}
	}

	return nil
}

func isContextEnd(err error, ctx context.Context) bool {
	if err == nil {
		return ctx.Err() != nil
	}

	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func resolveCacheSize(value int) int {
	if value <= 0 {
		return defaultDedupeCacheSize
	}

	return value
}

func normalizeBackoffPolicy(backoff BackoffPolicy) BackoffPolicy {
	initial := backoff.InitialDelay
	if initial <= 0 {
		initial = defaultInitialBackoffDelay
	}

	maximum := backoff.MaxDelay
	if maximum <= 0 {
		maximum = defaultMaxBackoffDelay
	}

	if maximum < initial {
		maximum = initial
	}

	multiplier := backoff.Multiplier
	if multiplier <= 1 {
		multiplier = defaultBackoffMultiplier
	}

	return BackoffPolicy{
		InitialDelay: initial,
		MaxDelay:     maximum,
		Multiplier:   multiplier,
	}
}

type backoffState struct {
	policy BackoffPolicy
	next   time.Duration
}

func newBackoffState(policy BackoffPolicy) *backoffState {
	return &backoffState{
		policy: policy,
		next:   policy.InitialDelay,
	}
}

func (state *backoffState) Reset() {
	state.next = state.policy.InitialDelay
}

func (state *backoffState) NextDelay() time.Duration {
	delay := state.next
	scaled := time.Duration(float64(state.next) * state.policy.Multiplier)
	if scaled < state.policy.InitialDelay {
		scaled = state.policy.InitialDelay
	}
	if scaled > state.policy.MaxDelay {
		scaled = state.policy.MaxDelay
	}
	state.next = scaled
	return delay
}

type messageDeduper struct {
	mu        sync.Mutex
	inFlight  map[string]struct{}
	processed *recentEventIDCache
}

func newMessageDeduper(cacheSize int) *messageDeduper {
	return &messageDeduper{
		inFlight:  make(map[string]struct{}),
		processed: newRecentEventIDCache(cacheSize),
	}
}

func (deduper *messageDeduper) Start(eventID string) bool {
	deduper.mu.Lock()
	defer deduper.mu.Unlock()

	if deduper.processed.Has(eventID) {
		return false
	}

	if _, exists := deduper.inFlight[eventID]; exists {
		return false
	}

	deduper.inFlight[eventID] = struct{}{}
	return true
}

func (deduper *messageDeduper) Finish(eventID string, success bool) {
	deduper.mu.Lock()
	defer deduper.mu.Unlock()

	delete(deduper.inFlight, eventID)
	if success {
		deduper.processed.Add(eventID)
	}
}

type recentEventIDCache struct {
	capacity int
	set      map[string]struct{}
	queue    []string
}

func newRecentEventIDCache(capacity int) *recentEventIDCache {
	return &recentEventIDCache{
		capacity: capacity,
		set:      make(map[string]struct{}, capacity),
		queue:    make([]string, 0, capacity),
	}
}

func (cache *recentEventIDCache) Has(eventID string) bool {
	_, exists := cache.set[eventID]
	return exists
}

func (cache *recentEventIDCache) Add(eventID string) {
	if _, exists := cache.set[eventID]; exists {
		return
	}

	cache.set[eventID] = struct{}{}
	cache.queue = append(cache.queue, eventID)

	if len(cache.queue) <= cache.capacity {
		return
	}

	oldestEventID := cache.queue[0]
	cache.queue = cache.queue[1:]
	delete(cache.set, oldestEventID)
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
