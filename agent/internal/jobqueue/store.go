package jobqueue

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
)

const (
	queueSubdirectory   = "queue"
	pendingSubdirectory = "pending"
	failedSubdirectory  = "failed"
)

// QueuedJob represents one command persisted for durable local retry.
type QueuedJob struct {
	EventID          string    `json:"eventId"`
	TraceID          string    `json:"traceId"`
	JobID            string    `json:"jobId"`
	PrinterID        string    `json:"printerId"`
	ObjectURL        string    `json:"objectUrl"`
	QueuedAt         time.Time `json:"queuedAt"`
	AttemptCount     int       `json:"attemptCount"`
	NextAttemptAt    time.Time `json:"nextAttemptAt"`
	LastErrorCode    string    `json:"lastErrorCode,omitempty"`
	LastErrorMessage string    `json:"lastErrorMessage,omitempty"`
}

// FailedJob represents a terminal failure record persisted for operator debugging.
type FailedJob struct {
	QueuedJob
	FinalErrorCode    string    `json:"finalErrorCode"`
	FinalErrorMessage string    `json:"finalErrorMessage"`
	FinalLPOutput     string    `json:"finalLpOutput,omitempty"`
	FailedAt          time.Time `json:"failedAt"`
}

// Store provides atomic persistence for pending and failed jobs.
type Store struct {
	pendingDir string
	failedDir  string
	mu         sync.Mutex
}

func NewStore(spoolDir string) (*Store, error) {
	normalizedSpoolDir := strings.TrimSpace(spoolDir)
	if normalizedSpoolDir == "" {
		return nil, errors.New("spool directory must be a non-empty string")
	}

	queueRoot := filepath.Join(normalizedSpoolDir, queueSubdirectory)
	pendingDir := filepath.Join(queueRoot, pendingSubdirectory)
	failedDir := filepath.Join(queueRoot, failedSubdirectory)

	if err := os.MkdirAll(pendingDir, 0o700); err != nil {
		return nil, fmt.Errorf("create pending queue directory: %w", err)
	}
	if err := os.MkdirAll(failedDir, 0o700); err != nil {
		return nil, fmt.Errorf("create failed queue directory: %w", err)
	}

	return &Store{
		pendingDir: pendingDir,
		failedDir:  failedDir,
	}, nil
}

func (store *Store) Enqueue(command jobexec.Command, now time.Time) (QueuedJob, bool, error) {
	queuedJob := QueuedJob{
		EventID:       strings.TrimSpace(command.EventID),
		TraceID:       strings.TrimSpace(command.TraceID),
		JobID:         strings.TrimSpace(command.JobID),
		PrinterID:     strings.TrimSpace(command.PrinterID),
		ObjectURL:     strings.TrimSpace(command.ObjectURL),
		QueuedAt:      now.UTC(),
		AttemptCount:  0,
		NextAttemptAt: now.UTC(),
	}
	if err := validateQueuedJob(queuedJob); err != nil {
		return QueuedJob{}, false, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	pendingPath := store.pendingPath(queuedJob.EventID)
	pendingExists, err := pathExists(pendingPath)
	if err != nil {
		return QueuedJob{}, false, err
	}
	if pendingExists {
		return QueuedJob{}, false, nil
	}

	failedPath := store.failedPath(queuedJob.EventID)
	failedExists, err := pathExists(failedPath)
	if err != nil {
		return QueuedJob{}, false, err
	}
	if failedExists {
		return QueuedJob{}, false, nil
	}

	if err := writeJSONAtomic(pendingPath, queuedJob); err != nil {
		return QueuedJob{}, false, err
	}

	return queuedJob, true, nil
}

func (store *Store) SavePending(queuedJob QueuedJob) error {
	if err := validateQueuedJob(queuedJob); err != nil {
		return err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	return writeJSONAtomic(store.pendingPath(queuedJob.EventID), queuedJob)
}

func (store *Store) DeletePending(eventID string) error {
	normalizedEventID := strings.TrimSpace(eventID)
	if normalizedEventID == "" {
		return errors.New("eventId is required")
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	err := os.Remove(store.pendingPath(normalizedEventID))
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return nil
	}

	return fmt.Errorf("delete pending job %q: %w", normalizedEventID, err)
}

func (store *Store) MovePendingToFailed(failedJob FailedJob) error {
	if err := validateQueuedJob(failedJob.QueuedJob); err != nil {
		return err
	}

	failedJob.FailedAt = failedJob.FailedAt.UTC()

	store.mu.Lock()
	defer store.mu.Unlock()

	pendingPath := store.pendingPath(failedJob.EventID)
	failedPath := store.failedPath(failedJob.EventID)

	if err := os.Rename(pendingPath, failedPath); err != nil {
		return fmt.Errorf("move pending job %q to failed queue: %w", failedJob.EventID, err)
	}

	return writeJSONAtomic(failedPath, failedJob)
}

func (store *Store) ListReady(now time.Time, limit int) ([]QueuedJob, error) {
	normalizedNow := now.UTC()
	if limit <= 0 {
		limit = 100
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	queuedJobs, err := store.listPendingLocked()
	if err != nil {
		return nil, err
	}

	readyJobs := make([]QueuedJob, 0, len(queuedJobs))
	for _, queuedJob := range queuedJobs {
		if queuedJob.NextAttemptAt.After(normalizedNow) {
			continue
		}
		readyJobs = append(readyJobs, queuedJob)
	}

	sort.SliceStable(readyJobs, func(left, right int) bool {
		if readyJobs[left].NextAttemptAt.Equal(readyJobs[right].NextAttemptAt) {
			if readyJobs[left].QueuedAt.Equal(readyJobs[right].QueuedAt) {
				return readyJobs[left].EventID < readyJobs[right].EventID
			}
			return readyJobs[left].QueuedAt.Before(readyJobs[right].QueuedAt)
		}
		return readyJobs[left].NextAttemptAt.Before(readyJobs[right].NextAttemptAt)
	})

	if len(readyJobs) > limit {
		readyJobs = readyJobs[:limit]
	}

	return readyJobs, nil
}

func (store *Store) NextAttemptAt() (time.Time, bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	queuedJobs, err := store.listPendingLocked()
	if err != nil {
		return time.Time{}, false, err
	}

	if len(queuedJobs) == 0 {
		return time.Time{}, false, nil
	}

	next := queuedJobs[0].NextAttemptAt
	for _, queuedJob := range queuedJobs[1:] {
		if queuedJob.NextAttemptAt.Before(next) {
			next = queuedJob.NextAttemptAt
		}
	}

	return next, true, nil
}

func (store *Store) listPendingLocked() ([]QueuedJob, error) {
	entries, err := os.ReadDir(store.pendingDir)
	if err != nil {
		return nil, fmt.Errorf("read pending queue directory: %w", err)
	}

	queuedJobs := make([]QueuedJob, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		path := filepath.Join(store.pendingDir, entry.Name())
		payload, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read pending queue file %q: %w", path, err)
		}

		var queuedJob QueuedJob
		if err := json.Unmarshal(payload, &queuedJob); err != nil {
			return nil, fmt.Errorf("decode pending queue file %q: %w", path, err)
		}

		if err := validateQueuedJob(queuedJob); err != nil {
			return nil, fmt.Errorf("validate pending queue file %q: %w", path, err)
		}

		queuedJobs = append(queuedJobs, queuedJob)
	}

	return queuedJobs, nil
}

func (store *Store) pendingPath(eventID string) string {
	return filepath.Join(store.pendingDir, queueRecordFilename(eventID))
}

func (store *Store) failedPath(eventID string) string {
	return filepath.Join(store.failedDir, queueRecordFilename(eventID))
}

func writeJSONAtomic(path string, value any) error {
	directory := filepath.Dir(path)
	temporaryFile, err := os.CreateTemp(directory, "*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary file in %q: %w", directory, err)
	}

	temporaryPath := temporaryFile.Name()
	encoder := json.NewEncoder(temporaryFile)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		_ = temporaryFile.Close()
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("write temporary file %q: %w", temporaryPath, err)
	}

	if err := temporaryFile.Chmod(0o600); err != nil {
		_ = temporaryFile.Close()
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("set temporary file permissions %q: %w", temporaryPath, err)
	}

	if err := temporaryFile.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("close temporary file %q: %w", temporaryPath, err)
	}

	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("rename temporary file %q to %q: %w", temporaryPath, path, err)
	}

	return nil
}

func validateQueuedJob(queuedJob QueuedJob) error {
	if strings.TrimSpace(queuedJob.EventID) == "" {
		return errors.New("eventId is required")
	}
	if strings.TrimSpace(queuedJob.TraceID) == "" {
		return errors.New("traceId is required")
	}
	if strings.TrimSpace(queuedJob.JobID) == "" {
		return errors.New("jobId is required")
	}
	if strings.TrimSpace(queuedJob.PrinterID) == "" {
		return errors.New("printerId is required")
	}
	if strings.TrimSpace(queuedJob.ObjectURL) == "" {
		return errors.New("objectUrl is required")
	}
	if queuedJob.QueuedAt.IsZero() {
		return errors.New("queuedAt is required")
	}
	if queuedJob.NextAttemptAt.IsZero() {
		return errors.New("nextAttemptAt is required")
	}
	if queuedJob.AttemptCount < 0 {
		return errors.New("attemptCount must be greater than or equal to zero")
	}

	return nil
}

func pathExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, fmt.Errorf("stat %q: %w", path, err)
}

func queueRecordFilename(eventID string) string {
	normalizedEventID := strings.TrimSpace(eventID)
	if normalizedEventID == "" {
		return "unknown.json"
	}

	return fmt.Sprintf("%s.json", base64.RawURLEncoding.EncodeToString([]byte(normalizedEventID)))
}
