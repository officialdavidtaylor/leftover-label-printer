package jobexec

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	defaultHTTPTimeout          = 30 * time.Second
	defaultMaxDownloadB         = int64(20 * 1024 * 1024)
	pdfSignature                = "%PDF-"
	outcomePrinted      Outcome = "printed"
	outcomeFailed       Outcome = "failed"
)

// Outcome mirrors terminal job states expected by backend status transition handling.
type Outcome string

const (
	OutcomePrinted Outcome = outcomePrinted
	OutcomeFailed  Outcome = outcomeFailed
)

// Command is the minimal dispatch payload required to fetch and print one job.
type Command struct {
	EventID   string
	TraceID   string
	JobID     string
	PrinterID string
	ObjectURL string
}

// Result captures deterministic execution outcome details for status event emission.
type Result struct {
	Outcome      Outcome
	ErrorCode    string
	ErrorMessage string
	LPOutput     string
}

// HTTPDoer allows tests to inject a deterministic HTTP client.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// CommandRunner allows tests to stub lp invocation.
type CommandRunner interface {
	Run(ctx context.Context, binary string, args ...string) ([]byte, error)
}

// Config configures print command execution and dependency injection hooks.
type Config struct {
	SpoolDir         string
	CUPSPrinterName  string
	LPCommandPath    string
	HTTPClient       HTTPDoer
	CommandRunner    CommandRunner
	MaxDownloadBytes int64
}

// Executor executes print commands from URL download through lp invocation.
type Executor struct {
	spoolDir        string
	cupsPrinterName string
	lpCommandPath   string
	httpClient      HTTPDoer
	commandRunner   CommandRunner
	maxDownloadB    int64
}

// NewExecutor validates configuration and returns a reusable command executor.
func NewExecutor(config Config) (*Executor, error) {
	spoolDir := strings.TrimSpace(config.SpoolDir)
	if spoolDir == "" {
		return nil, errors.New("spool directory must be a non-empty string")
	}

	cupsPrinterName := strings.TrimSpace(config.CUPSPrinterName)
	if cupsPrinterName == "" {
		return nil, errors.New("CUPS printer name must be a non-empty string")
	}

	lpCommandPath := strings.TrimSpace(config.LPCommandPath)
	if lpCommandPath == "" {
		return nil, errors.New("lp command path must be a non-empty string")
	}

	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}

	commandRunner := config.CommandRunner
	if commandRunner == nil {
		commandRunner = defaultCommandRunner{}
	}

	maxDownloadBytes := config.MaxDownloadBytes
	if maxDownloadBytes <= 0 {
		maxDownloadBytes = defaultMaxDownloadB
	}

	return &Executor{
		spoolDir:        spoolDir,
		cupsPrinterName: cupsPrinterName,
		lpCommandPath:   lpCommandPath,
		httpClient:      httpClient,
		commandRunner:   commandRunner,
		maxDownloadB:    maxDownloadBytes,
	}, nil
}

// Execute runs one command and always returns a terminal printed/failed result.
func (executor *Executor) Execute(ctx context.Context, command Command) Result {
	if err := validateCommand(command); err != nil {
		return failureResult("invalid_command", err.Error(), "")
	}

	downloadURL, err := parseDownloadURL(command.ObjectURL)
	if err != nil {
		return failureResult("invalid_command", err.Error(), "")
	}

	if err := os.MkdirAll(executor.spoolDir, 0o700); err != nil {
		return failureResult("spool_prepare_failed", fmt.Sprintf("create spool directory: %v", err), "")
	}

	downloadedFilePath, downloadErr := executor.downloadPDF(ctx, downloadURL, command.JobID)
	if downloadErr != nil {
		return failureResult(downloadErr.code, downloadErr.message, "")
	}
	defer func() {
		_ = os.Remove(downloadedFilePath)
	}()

	lpOutputRaw, lpErr := executor.commandRunner.Run(
		ctx,
		executor.lpCommandPath,
		"-d",
		executor.cupsPrinterName,
		downloadedFilePath,
	)
	lpOutput := strings.TrimSpace(string(lpOutputRaw))

	if lpErr != nil {
		return failureResult("print_failed", fmt.Sprintf("lp command failed: %v", lpErr), lpOutput)
	}

	return Result{
		Outcome:  outcomePrinted,
		LPOutput: lpOutput,
	}
}

func validateCommand(command Command) error {
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

	return nil
}

func parseDownloadURL(rawURL string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("objectUrl must be an absolute URI: %w", err)
	}

	if parsed.Host == "" {
		return nil, errors.New("objectUrl must include host")
	}

	switch parsed.Scheme {
	case "http", "https":
	default:
		return nil, fmt.Errorf("objectUrl scheme %q is not supported", parsed.Scheme)
	}

	return parsed, nil
}

type downloadError struct {
	code    string
	message string
}

func (executor *Executor) downloadPDF(ctx context.Context, downloadURL *url.URL, jobID string) (string, *downloadError) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL.String(), http.NoBody)
	if err != nil {
		return "", &downloadError{
			code:    "download_failed",
			message: fmt.Sprintf("build download request: %v", err),
		}
	}

	response, err := executor.httpClient.Do(request)
	if err != nil {
		return "", &downloadError{
			code:    "download_failed",
			message: fmt.Sprintf("request rendered PDF: %v", err),
		}
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", &downloadError{
			code:    "download_failed",
			message: fmt.Sprintf("rendered PDF request returned status %d", response.StatusCode),
		}
	}

	payload, err := io.ReadAll(io.LimitReader(response.Body, executor.maxDownloadB+1))
	if err != nil {
		return "", &downloadError{
			code:    "download_failed",
			message: fmt.Sprintf("read rendered PDF body: %v", err),
		}
	}

	if int64(len(payload)) > executor.maxDownloadB {
		return "", &downloadError{
			code:    "download_failed",
			message: fmt.Sprintf("rendered PDF exceeded max allowed size (%d bytes)", executor.maxDownloadB),
		}
	}

	if !bytes.HasPrefix(payload, []byte(pdfSignature)) {
		return "", &downloadError{
			code:    "invalid_pdf_payload",
			message: "downloaded object is not a PDF",
		}
	}

	file, err := os.CreateTemp(executor.spoolDir, fmt.Sprintf("job-%s-*.pdf", sanitizeFileSegment(jobID)))
	if err != nil {
		return "", &downloadError{
			code:    "spool_write_failed",
			message: fmt.Sprintf("create spool file: %v", err),
		}
	}

	path := file.Name()
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return "", &downloadError{
			code:    "spool_write_failed",
			message: fmt.Sprintf("write spool file: %v", err),
		}
	}

	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return "", &downloadError{
			code:    "spool_write_failed",
			message: fmt.Sprintf("set spool file permissions: %v", err),
		}
	}

	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", &downloadError{
			code:    "spool_write_failed",
			message: fmt.Sprintf("close spool file: %v", err),
		}
	}

	return path, nil
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

func failureResult(code string, message string, lpOutput string) Result {
	return Result{
		Outcome:      outcomeFailed,
		ErrorCode:    code,
		ErrorMessage: message,
		LPOutput:     lpOutput,
	}
}

type defaultCommandRunner struct{}

func (defaultCommandRunner) Run(ctx context.Context, binary string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, binary, args...)
	return command.CombinedOutput()
}
