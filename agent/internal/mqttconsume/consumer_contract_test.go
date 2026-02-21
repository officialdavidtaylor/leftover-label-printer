package mqttconsume

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParsePrintJobCommandAcceptsContractPayloadVariants(t *testing.T) {
	tests := []struct {
		name      string
		overrides map[string]any
	}{
		{
			name:      "canonical payload",
			overrides: nil,
		},
		{
			name: "new minor schema version",
			overrides: map[string]any{
				"schemaVersion": "1.9.3",
			},
		},
		{
			name: "rfc3339 nano issued timestamp",
			overrides: map[string]any{
				"issuedAt": "2026-02-21T00:00:00.123456789-05:00",
			},
		},
		{
			name: "presigned object URL",
			overrides: map[string]any{
				"objectUrl": "https://downloads.example.com/labels/job-1.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123",
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			payload := commandPayloadWithOverrides(testCase.overrides)
			rawPayload, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}

			logger := &capturingLogger{}
			command, ok := parsePrintJobCommand(rawPayload, logger)
			if !ok {
				t.Fatalf("expected payload variant to parse, warnings=%+v", logger.warns)
			}

			if command.EventID != payload["eventId"] {
				t.Fatalf("unexpected eventId: got %q want %q", command.EventID, payload["eventId"])
			}

			if len(logger.warns) != 0 {
				t.Fatalf("expected no warning logs, got %+v", logger.warns)
			}
		})
	}
}

func TestParsePrintJobCommandRejectsMissingRequiredFieldsDeterministically(t *testing.T) {
	tests := []struct {
		name          string
		missingField  string
		expectedError string
	}{
		{name: "missing eventId", missingField: "eventId", expectedError: "eventId is required"},
		{name: "missing traceId", missingField: "traceId", expectedError: "traceId is required"},
		{name: "missing jobId", missingField: "jobId", expectedError: "jobId is required"},
		{name: "missing printerId", missingField: "printerId", expectedError: "printerId is required"},
		{name: "missing objectUrl", missingField: "objectUrl", expectedError: "objectUrl is required"},
		{name: "missing issuedAt", missingField: "issuedAt", expectedError: "issuedAt is required"},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			payload := commandPayloadWithOverrides(nil)
			delete(payload, testCase.missingField)

			rawPayload, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}

			logger := &capturingLogger{}
			if _, ok := parsePrintJobCommand(rawPayload, logger); ok {
				t.Fatal("expected missing required field payload to be rejected")
			}

			assertSingleWarn(t, logger, "mqtt_command_schema_invalid", testCase.expectedError)
		})
	}
}

func TestParsePrintJobCommandRejectsInvalidRequiredFieldValues(t *testing.T) {
	tests := []struct {
		name          string
		overrides     map[string]any
		expectedError string
	}{
		{
			name: "invalid schema version major",
			overrides: map[string]any{
				"schemaVersion": "2.0.0",
			},
			expectedError: "schemaVersion must match major version 1 semver format",
		},
		{
			name: "invalid event type",
			overrides: map[string]any{
				"type": "print_job_status",
			},
			expectedError: "type must equal print_job_dispatch",
		},
		{
			name: "invalid object URL",
			overrides: map[string]any{
				"objectUrl": "/labels/job-1.pdf",
			},
			expectedError: "objectUrl must be an absolute URI",
		},
		{
			name: "invalid issued timestamp format",
			overrides: map[string]any{
				"issuedAt": "2026-02-21",
			},
			expectedError: "issuedAt must be a valid RFC3339 timestamp",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			payload := commandPayloadWithOverrides(testCase.overrides)

			rawPayload, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}

			logger := &capturingLogger{}
			if _, ok := parsePrintJobCommand(rawPayload, logger); ok {
				t.Fatal("expected invalid payload to be rejected")
			}

			assertSingleWarn(t, logger, "mqtt_command_schema_invalid", testCase.expectedError)
		})
	}
}

func TestParsePrintJobCommandRejectsUnknownFields(t *testing.T) {
	payload := commandPayloadWithOverrides(map[string]any{
		"unexpectedField": "not-allowed",
	})

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	logger := &capturingLogger{}
	if _, ok := parsePrintJobCommand(rawPayload, logger); ok {
		t.Fatal("expected payload with unknown field to be rejected")
	}

	if len(logger.warns) != 1 {
		t.Fatalf("expected one warning log, got %+v", logger.warns)
	}

	if logger.warns[0].event != "mqtt_command_decode_failed" {
		t.Fatalf("expected mqtt_command_decode_failed, got %q", logger.warns[0].event)
	}

	errorValue, _ := logger.warns[0].fields["error"].(string)
	if !strings.Contains(errorValue, `unknown field "unexpectedField"`) {
		t.Fatalf("unexpected decode error: %q", errorValue)
	}
}

func commandPayloadWithOverrides(overrides map[string]any) map[string]any {
	baseCommand := buildCommand(nil)
	payload := make(map[string]any, len(baseCommand))
	for key, value := range baseCommand {
		payload[key] = value
	}

	for key, value := range overrides {
		payload[key] = value
	}

	return payload
}

func assertSingleWarn(t *testing.T, logger *capturingLogger, expectedEvent string, expectedError string) {
	t.Helper()

	if len(logger.warns) != 1 {
		t.Fatalf("expected one warning log, got %+v", logger.warns)
	}

	if logger.warns[0].event != expectedEvent {
		t.Fatalf("expected event %q, got %q", expectedEvent, logger.warns[0].event)
	}

	errorValue, _ := logger.warns[0].fields["error"].(string)
	if errorValue != expectedError {
		t.Fatalf("unexpected warning error, got %q want %q", errorValue, expectedError)
	}
}

type capturedLog struct {
	event  string
	fields map[string]any
}

type capturingLogger struct {
	infos []capturedLog
	warns []capturedLog
}

func (logger *capturingLogger) Info(event string, fields map[string]any) {
	logger.infos = append(logger.infos, capturedLog{
		event:  event,
		fields: cloneLogFields(fields),
	})
}

func (logger *capturingLogger) Warn(event string, fields map[string]any) {
	logger.warns = append(logger.warns, capturedLog{
		event:  event,
		fields: cloneLogFields(fields),
	})
}

func cloneLogFields(fields map[string]any) map[string]any {
	if fields == nil {
		return nil
	}

	cloned := make(map[string]any, len(fields))
	for key, value := range fields {
		cloned[key] = value
	}

	return cloned
}
