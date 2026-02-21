package jobexec

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestExecutePrintsDownloadedPDF(t *testing.T) {
	pdfPayload := []byte("%PDF-1.7\nmock\n")

	var (
		invokedBinary string
		invokedArgs   []string
		invokedBody   []byte
	)

	executor, err := NewExecutor(Config{
		SpoolDir:        t.TempDir(),
		CUPSPrinterName: "dymo",
		LPCommandPath:   "/usr/bin/lp",
		HTTPClient: fakeHTTPClient{
			do: func(request *http.Request) (*http.Response, error) {
				if request.Method != http.MethodGet {
					t.Fatalf("unexpected request method: %s", request.Method)
				}
				if request.URL.String() != "https://storage.example.com/rendered.pdf" {
					t.Fatalf("unexpected request URL: %s", request.URL.String())
				}
				return newHTTPResponse(http.StatusOK, pdfPayload), nil
			},
		},
		CommandRunner: fakeCommandRunner{
			run: func(_ context.Context, binary string, args ...string) ([]byte, error) {
				invokedBinary = binary
				invokedArgs = append([]string{}, args...)

				if len(args) != 3 {
					t.Fatalf("expected 3 lp args, got %v", args)
				}

				body, readErr := os.ReadFile(args[2])
				if readErr != nil {
					t.Fatalf("read spooled file: %v", readErr)
				}
				invokedBody = body

				return []byte("request id is dymo-42"), nil
			},
		},
	})
	if err != nil {
		t.Fatalf("NewExecutor returned error: %v", err)
	}

	result := executor.Execute(context.Background(), buildCommand("https://storage.example.com/rendered.pdf"))

	if result.Outcome != OutcomePrinted {
		t.Fatalf("expected printed outcome, got %q", result.Outcome)
	}

	if result.ErrorCode != "" || result.ErrorMessage != "" {
		t.Fatalf("expected no error details, got code=%q message=%q", result.ErrorCode, result.ErrorMessage)
	}

	if invokedBinary != "/usr/bin/lp" {
		t.Fatalf("unexpected lp binary: %q", invokedBinary)
	}

	if strings.Join(invokedArgs, " ") == "" {
		t.Fatal("expected lp args to be captured")
	}

	if !bytes.Equal(invokedBody, pdfPayload) {
		t.Fatalf("unexpected spooled PDF body: %q", string(invokedBody))
	}

	if result.LPOutput != "request id is dymo-42" {
		t.Fatalf("unexpected lp output: %q", result.LPOutput)
	}
}

func TestExecuteReturnsDownloadFailureForNon200Response(t *testing.T) {
	executor := mustExecutor(t, Config{
		SpoolDir:        t.TempDir(),
		CUPSPrinterName: "dymo",
		LPCommandPath:   "/usr/bin/lp",
		HTTPClient: fakeHTTPClient{
			do: func(*http.Request) (*http.Response, error) {
				return newHTTPResponse(http.StatusForbidden, []byte("forbidden")), nil
			},
		},
	})

	result := executor.Execute(context.Background(), buildCommand("https://storage.example.com/rendered.pdf"))

	if result.Outcome != OutcomeFailed {
		t.Fatalf("expected failed outcome, got %q", result.Outcome)
	}

	if result.ErrorCode != "download_failed" {
		t.Fatalf("expected download_failed error code, got %q", result.ErrorCode)
	}
}

func TestExecuteRejectsNonPDFDownloads(t *testing.T) {
	executor := mustExecutor(t, Config{
		SpoolDir:        t.TempDir(),
		CUPSPrinterName: "dymo",
		LPCommandPath:   "/usr/bin/lp",
		HTTPClient: fakeHTTPClient{
			do: func(*http.Request) (*http.Response, error) {
				return newHTTPResponse(http.StatusOK, []byte("not-a-pdf")), nil
			},
		},
	})

	result := executor.Execute(context.Background(), buildCommand("https://storage.example.com/rendered.pdf"))

	if result.Outcome != OutcomeFailed {
		t.Fatalf("expected failed outcome, got %q", result.Outcome)
	}

	if result.ErrorCode != "invalid_pdf_payload" {
		t.Fatalf("expected invalid_pdf_payload error code, got %q", result.ErrorCode)
	}
}

func TestExecuteReturnsPrintFailureWhenLPFails(t *testing.T) {
	pdfPayload := []byte("%PDF-1.4\nprint-test\n")

	executor := mustExecutor(t, Config{
		SpoolDir:        t.TempDir(),
		CUPSPrinterName: "dymo",
		LPCommandPath:   "/usr/bin/lp",
		HTTPClient: fakeHTTPClient{
			do: func(*http.Request) (*http.Response, error) {
				return newHTTPResponse(http.StatusOK, pdfPayload), nil
			},
		},
		CommandRunner: fakeCommandRunner{
			run: func(context.Context, string, ...string) ([]byte, error) {
				return []byte("lp: printer busy"), errors.New("exit status 1")
			},
		},
	})

	result := executor.Execute(context.Background(), buildCommand("https://storage.example.com/rendered.pdf"))

	if result.Outcome != OutcomeFailed {
		t.Fatalf("expected failed outcome, got %q", result.Outcome)
	}

	if result.ErrorCode != "print_failed" {
		t.Fatalf("expected print_failed error code, got %q", result.ErrorCode)
	}

	if !strings.Contains(result.ErrorMessage, "exit status 1") {
		t.Fatalf("expected lp exit details in error message, got %q", result.ErrorMessage)
	}

	if result.LPOutput != "lp: printer busy" {
		t.Fatalf("unexpected lp output: %q", result.LPOutput)
	}
}

func TestExecuteRejectsInvalidURLSchemes(t *testing.T) {
	executor := mustExecutor(t, Config{
		SpoolDir:        t.TempDir(),
		CUPSPrinterName: "dymo",
		LPCommandPath:   "/usr/bin/lp",
	})

	command := buildCommand("ftp://example.com/file.pdf")
	result := executor.Execute(context.Background(), command)

	if result.Outcome != OutcomeFailed {
		t.Fatalf("expected failed outcome, got %q", result.Outcome)
	}

	if result.ErrorCode != "invalid_command" {
		t.Fatalf("expected invalid_command error code, got %q", result.ErrorCode)
	}
}

func buildCommand(objectURL string) Command {
	return Command{
		EventID:   "event-123",
		TraceID:   "trace-123",
		JobID:     "job-123",
		PrinterID: "printer-01",
		ObjectURL: objectURL,
	}
}

func mustExecutor(t *testing.T, config Config) *Executor {
	t.Helper()

	executor, err := NewExecutor(config)
	if err != nil {
		t.Fatalf("NewExecutor returned error: %v", err)
	}

	return executor
}

type fakeCommandRunner struct {
	run func(context.Context, string, ...string) ([]byte, error)
}

func (runner fakeCommandRunner) Run(ctx context.Context, binary string, args ...string) ([]byte, error) {
	return runner.run(ctx, binary, args...)
}

type fakeHTTPClient struct {
	do func(*http.Request) (*http.Response, error)
}

func (client fakeHTTPClient) Do(request *http.Request) (*http.Response, error) {
	return client.do(request)
}

func newHTTPResponse(statusCode int, body []byte) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     make(http.Header),
	}
}
