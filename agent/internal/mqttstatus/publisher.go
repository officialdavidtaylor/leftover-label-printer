package mqttstatus

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
)

const defaultSchemaVersion = "1.0.0"

var schemaVersionPattern = regexp.MustCompile(`^1\.[0-9]+\.[0-9]+$`)

type PrintJobOutcomePayload struct {
	SchemaVersion string `json:"schemaVersion"`
	Type          string `json:"type"`
	EventID       string `json:"eventId"`
	TraceID       string `json:"traceId"`
	JobID         string `json:"jobId"`
	PrinterID     string `json:"printerId"`
	Outcome       string `json:"outcome"`
	OccurredAt    string `json:"occurredAt"`
	ErrorCode     string `json:"errorCode,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}

type PublishPrintJobOutcomeInput struct {
	TraceID      string
	JobID        string
	PrinterID    string
	Outcome      jobexec.Outcome
	ErrorCode    string
	ErrorMessage string
}

type PublishPrintJobOutcomeResult struct {
	Topic   string
	QoS     byte
	Payload PrintJobOutcomePayload
}

type Publisher struct {
	client        mqttconsume.Client
	schemaVersion string
	now           func() time.Time
	createEventID func() string
	mu            sync.Mutex
}

type Config struct {
	Client        mqttconsume.Client
	SchemaVersion string
	Now           func() time.Time
	CreateEventID func() string
}

func NewPublisher(config Config) (*Publisher, error) {
	if config.Client == nil {
		return nil, errors.New("client is required")
	}

	schemaVersion := strings.TrimSpace(config.SchemaVersion)
	if schemaVersion == "" {
		schemaVersion = defaultSchemaVersion
	}
	if !schemaVersionPattern.MatchString(schemaVersion) {
		return nil, errors.New("schemaVersion must match major version 1 semver format")
	}

	now := config.Now
	if now == nil {
		now = time.Now
	}

	createEventID := config.CreateEventID
	if createEventID == nil {
		createEventID = defaultCreateEventID
	}

	return &Publisher{
		client:        config.Client,
		schemaVersion: schemaVersion,
		now:           now,
		createEventID: createEventID,
	}, nil
}

func (publisher *Publisher) PublishPrintJobOutcome(
	ctx context.Context,
	input PublishPrintJobOutcomeInput,
) (PublishPrintJobOutcomeResult, error) {
	payload, err := publisher.BuildPrintJobOutcomePayload(input)
	if err != nil {
		return PublishPrintJobOutcomeResult{}, err
	}

	return publisher.PublishPayload(ctx, payload)
}

func (publisher *Publisher) BuildPrintJobOutcomePayload(
	input PublishPrintJobOutcomeInput,
) (PrintJobOutcomePayload, error) {
	payload, _, err := publisher.buildPayload(input)
	if err != nil {
		return PrintJobOutcomePayload{}, err
	}

	return payload, nil
}

func (publisher *Publisher) PublishPayload(
	ctx context.Context,
	payload PrintJobOutcomePayload,
) (PublishPrintJobOutcomeResult, error) {
	topic, err := validatePrintJobOutcomePayload(payload)
	if err != nil {
		return PublishPrintJobOutcomeResult{}, err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return PublishPrintJobOutcomeResult{}, fmt.Errorf("marshal print outcome payload: %w", err)
	}

	publisher.mu.Lock()
	defer publisher.mu.Unlock()

	session, err := publisher.client.Connect(ctx)
	if err != nil {
		return PublishPrintJobOutcomeResult{}, fmt.Errorf("connect mqtt publisher: %w", err)
	}
	defer func() {
		_ = session.Close()
	}()

	if err := session.Publish(ctx, topic, body); err != nil {
		return PublishPrintJobOutcomeResult{}, fmt.Errorf("publish print outcome: %w", err)
	}

	return PublishPrintJobOutcomeResult{
		Topic:   topic,
		QoS:     1,
		Payload: payload,
	}, nil
}

func (publisher *Publisher) buildPayload(input PublishPrintJobOutcomeInput) (PrintJobOutcomePayload, string, error) {
	traceID := strings.TrimSpace(input.TraceID)
	if traceID == "" {
		return PrintJobOutcomePayload{}, "", errors.New("traceId is required")
	}

	jobID := strings.TrimSpace(input.JobID)
	if jobID == "" {
		return PrintJobOutcomePayload{}, "", errors.New("jobId is required")
	}

	printerID := strings.TrimSpace(input.PrinterID)
	if printerID == "" {
		return PrintJobOutcomePayload{}, "", errors.New("printerId is required")
	}

	topic, err := mqttconsume.PrinterStatusTopic(printerID)
	if err != nil {
		return PrintJobOutcomePayload{}, "", err
	}

	outcome := strings.TrimSpace(string(input.Outcome))
	if outcome != string(jobexec.OutcomePrinted) && outcome != string(jobexec.OutcomeFailed) {
		return PrintJobOutcomePayload{}, "", errors.New("outcome must be printed or failed")
	}

	errorCode := strings.TrimSpace(input.ErrorCode)
	errorMessage := strings.TrimSpace(input.ErrorMessage)
	if input.Outcome == jobexec.OutcomeFailed {
		if errorCode == "" {
			return PrintJobOutcomePayload{}, "", errors.New("errorCode is required for failed outcomes")
		}
		if errorMessage == "" {
			return PrintJobOutcomePayload{}, "", errors.New("errorMessage is required for failed outcomes")
		}
	}

	payload := PrintJobOutcomePayload{
		SchemaVersion: publisher.schemaVersion,
		Type:          outcome,
		EventID:       strings.TrimSpace(publisher.createEventID()),
		TraceID:       traceID,
		JobID:         jobID,
		PrinterID:     printerID,
		Outcome:       outcome,
		OccurredAt:    publisher.now().UTC().Format(time.RFC3339Nano),
		ErrorCode:     errorCode,
		ErrorMessage:  errorMessage,
	}

	if payload.EventID == "" {
		return PrintJobOutcomePayload{}, "", errors.New("eventId is required")
	}

	return payload, topic, nil
}

func validatePrintJobOutcomePayload(payload PrintJobOutcomePayload) (string, error) {
	if !schemaVersionPattern.MatchString(strings.TrimSpace(payload.SchemaVersion)) {
		return "", errors.New("schemaVersion must match major version 1 semver format")
	}
	if strings.TrimSpace(payload.EventID) == "" {
		return "", errors.New("eventId is required")
	}
	if strings.TrimSpace(payload.TraceID) == "" {
		return "", errors.New("traceId is required")
	}
	if strings.TrimSpace(payload.JobID) == "" {
		return "", errors.New("jobId is required")
	}
	if strings.TrimSpace(payload.PrinterID) == "" {
		return "", errors.New("printerId is required")
	}
	if strings.TrimSpace(payload.Outcome) != strings.TrimSpace(payload.Type) {
		return "", errors.New("outcome must match type")
	}
	if strings.TrimSpace(payload.Type) != string(jobexec.OutcomePrinted) &&
		strings.TrimSpace(payload.Type) != string(jobexec.OutcomeFailed) {
		return "", errors.New("type must be printed or failed")
	}
	if strings.TrimSpace(payload.OccurredAt) == "" {
		return "", errors.New("occurredAt is required")
	}
	if _, err := time.Parse(time.RFC3339, payload.OccurredAt); err != nil {
		if _, secondErr := time.Parse(time.RFC3339Nano, payload.OccurredAt); secondErr != nil {
			return "", errors.New("occurredAt must be a valid RFC3339 timestamp")
		}
	}
	if payload.Type == string(jobexec.OutcomeFailed) {
		if strings.TrimSpace(payload.ErrorCode) == "" {
			return "", errors.New("errorCode is required for failed outcomes")
		}
		if strings.TrimSpace(payload.ErrorMessage) == "" {
			return "", errors.New("errorMessage is required for failed outcomes")
		}
	}

	topic, err := mqttconsume.PrinterStatusTopic(payload.PrinterID)
	if err != nil {
		return "", err
	}

	return topic, nil
}

func defaultCreateEventID() string {
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		return fmt.Sprintf("event-%d", time.Now().UTC().UnixNano())
	}

	return "event-" + hex.EncodeToString(randomBytes)
}
