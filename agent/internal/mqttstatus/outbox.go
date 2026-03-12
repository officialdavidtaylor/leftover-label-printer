package mqttstatus

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

const outboxDirectoryName = "status-outbox"

type OutcomePayloadPublisher interface {
	PublishPayload(ctx context.Context, payload PrintJobOutcomePayload) (PublishPrintJobOutcomeResult, error)
}

type PendingOutcomeRecord struct {
	DispatchEventID string                 `json:"dispatchEventId"`
	AttemptCount    int                    `json:"attemptCount"`
	LPOutput        string                 `json:"lpOutput,omitempty"`
	Payload         PrintJobOutcomePayload `json:"payload"`
}

type FileOutbox struct {
	directory string
}

func NewFileOutbox(spoolDir string) (*FileOutbox, error) {
	normalizedSpoolDir := strings.TrimSpace(spoolDir)
	if normalizedSpoolDir == "" {
		return nil, fmt.Errorf("spool directory must be a non-empty string")
	}

	directory := filepath.Join(normalizedSpoolDir, outboxDirectoryName)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create status outbox directory: %w", err)
	}

	return &FileOutbox{directory: directory}, nil
}

func (outbox *FileOutbox) Enqueue(record PendingOutcomeRecord) error {
	if err := validatePendingOutcomeRecord(record); err != nil {
		return err
	}

	body, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal outbox payload: %w", err)
	}

	pendingPath, err := outbox.pendingFilePath(record)
	if err != nil {
		return err
	}

	temporaryFile, err := os.CreateTemp(outbox.directory, "pending-*.json")
	if err != nil {
		return fmt.Errorf("create temporary outbox file: %w", err)
	}

	temporaryPath := temporaryFile.Name()
	if _, err := temporaryFile.Write(body); err != nil {
		_ = temporaryFile.Close()
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("write temporary outbox file: %w", err)
	}

	if err := temporaryFile.Chmod(0o600); err != nil {
		_ = temporaryFile.Close()
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("set temporary outbox file permissions: %w", err)
	}

	if err := temporaryFile.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("close temporary outbox file: %w", err)
	}

	if err := os.Rename(temporaryPath, pendingPath); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("finalize outbox file: %w", err)
	}

	return nil
}

func (outbox *FileOutbox) Drain(ctx context.Context, publisher OutcomePayloadPublisher) (int, error) {
	if publisher == nil {
		return 0, fmt.Errorf("publisher is required")
	}

	entryNames, err := outbox.entryNames()
	if err != nil {
		return 0, err
	}

	publishedCount := 0
	for _, entryName := range entryNames {
		record, err := outbox.readEntry(entryName)
		if err != nil {
			return publishedCount, err
		}

		if _, err := publisher.PublishPayload(ctx, record.Payload); err != nil {
			return publishedCount, err
		}

		if err := os.Remove(filepath.Join(outbox.directory, entryName)); err != nil {
			return publishedCount, fmt.Errorf("remove published outbox file: %w", err)
		}

		publishedCount++
	}

	return publishedCount, nil
}

func (outbox *FileOutbox) PendingRecord(dispatchEventID string) (PendingOutcomeRecord, bool, error) {
	normalizedDispatchEventID := strings.TrimSpace(dispatchEventID)
	if normalizedDispatchEventID == "" {
		return PendingOutcomeRecord{}, false, fmt.Errorf("dispatchEventId is required")
	}

	entryNames, err := outbox.entryNames()
	if err != nil {
		return PendingOutcomeRecord{}, false, err
	}

	for _, entryName := range entryNames {
		record, err := outbox.readEntry(entryName)
		if err != nil {
			return PendingOutcomeRecord{}, false, err
		}
		if record.DispatchEventID == normalizedDispatchEventID {
			return record, true, nil
		}
	}

	return PendingOutcomeRecord{}, false, nil
}

func (outbox *FileOutbox) entryNames() ([]string, error) {
	entries, err := os.ReadDir(outbox.directory)
	if err != nil {
		return nil, fmt.Errorf("read status outbox directory: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		names = append(names, entry.Name())
	}

	slices.Sort(names)
	return names, nil
}

func (outbox *FileOutbox) readEntry(entryName string) (PendingOutcomeRecord, error) {
	body, err := os.ReadFile(filepath.Join(outbox.directory, entryName))
	if err != nil {
		return PendingOutcomeRecord{}, fmt.Errorf("read outbox file: %w", err)
	}

	var record PendingOutcomeRecord
	if err := json.Unmarshal(body, &record); err != nil {
		return PendingOutcomeRecord{}, fmt.Errorf("decode outbox file: %w", err)
	}

	if err := validatePendingOutcomeRecord(record); err != nil {
		return PendingOutcomeRecord{}, err
	}

	return record, nil
}

func (outbox *FileOutbox) pendingFilePath(record PendingOutcomeRecord) (string, error) {
	occurredAt, err := time.Parse(time.RFC3339Nano, record.Payload.OccurredAt)
	if err != nil {
		occurredAt, err = time.Parse(time.RFC3339, record.Payload.OccurredAt)
		if err != nil {
			return "", fmt.Errorf("parse occurredAt for outbox file: %w", err)
		}
	}

	filename := fmt.Sprintf(
		"%020d-%s-%s.json",
		occurredAt.UTC().UnixNano(),
		sanitizeFileSegment(record.DispatchEventID),
		sanitizeFileSegment(record.Payload.EventID),
	)

	return filepath.Join(outbox.directory, filename), nil
}

func validatePendingOutcomeRecord(record PendingOutcomeRecord) error {
	if strings.TrimSpace(record.DispatchEventID) == "" {
		return fmt.Errorf("dispatchEventId is required")
	}
	if record.AttemptCount < 0 {
		return fmt.Errorf("attemptCount must be zero or greater")
	}
	if _, err := validatePrintJobOutcomePayload(record.Payload); err != nil {
		return err
	}

	return nil
}

func sanitizeFileSegment(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "unknown"
	}

	var builder strings.Builder
	for _, character := range trimmed {
		switch {
		case character >= 'a' && character <= 'z':
			builder.WriteRune(character)
		case character >= 'A' && character <= 'Z':
			builder.WriteRune(character)
		case character >= '0' && character <= '9':
			builder.WriteRune(character)
		case character == '-' || character == '_':
			builder.WriteRune(character)
		default:
			builder.WriteRune('-')
		}
	}

	sanitized := strings.Trim(builder.String(), "-")
	if sanitized == "" {
		return "unknown"
	}

	return sanitized
}
