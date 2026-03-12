package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadFromEnvDefaults(t *testing.T) {
	setRequiredEnv(t)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.PollInterval != 10*time.Second {
		t.Fatalf("expected default poll interval 10s, got %s", cfg.PollInterval)
	}

	if cfg.LPCommandPath != "/usr/bin/lp" {
		t.Fatalf("expected default LP command path /usr/bin/lp, got %q", cfg.LPCommandPath)
	}

	if cfg.RetryMaxAttempts != 5 {
		t.Fatalf("expected default retry max attempts 5, got %d", cfg.RetryMaxAttempts)
	}
	if cfg.RetryInitialDelay != 5*time.Second {
		t.Fatalf("expected default retry initial delay 5s, got %s", cfg.RetryInitialDelay)
	}
	if cfg.RetryMaxDelay != 60*time.Second {
		t.Fatalf("expected default retry max delay 60s, got %s", cfg.RetryMaxDelay)
	}
	if cfg.RetryMultiplier != 2 {
		t.Fatalf("expected default retry multiplier 2, got %v", cfg.RetryMultiplier)
	}

	if cfg.ValidateOnly {
		t.Fatal("expected validate-only mode to default false")
	}
}

func TestLoadFromEnvWithOverrides(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("AGENT_POLL_INTERVAL_SECONDS", "45")
	t.Setenv("LP_COMMAND_PATH", "/opt/local/bin/lp")
	t.Setenv("MQTT_BROKER_URL", "mqtt://broker.internal:1883")
	t.Setenv("MQTT_CLIENT_ID", "agent-printer-09")
	t.Setenv("MQTT_USERNAME", "agent-user")
	t.Setenv("MQTT_PASSWORD", "agent-pass")
	t.Setenv("AGENT_RETRY_MAX_ATTEMPTS", "8")
	t.Setenv("AGENT_RETRY_INITIAL_DELAY_SECONDS", "3")
	t.Setenv("AGENT_RETRY_MAX_DELAY_SECONDS", "15")
	t.Setenv("AGENT_RETRY_MULTIPLIER", "1.5")
	t.Setenv("AGENT_VALIDATE_ONLY", "true")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.PollInterval != 45*time.Second {
		t.Fatalf("expected poll interval 45s, got %s", cfg.PollInterval)
	}

	if cfg.LPCommandPath != "/opt/local/bin/lp" {
		t.Fatalf("expected LP command path override, got %q", cfg.LPCommandPath)
	}

	if cfg.MQTTBrokerURL != "mqtt://broker.internal:1883" {
		t.Fatalf("expected MQTT broker override, got %q", cfg.MQTTBrokerURL)
	}

	if cfg.MQTTClientID != "agent-printer-09" {
		t.Fatalf("expected MQTT client id override, got %q", cfg.MQTTClientID)
	}

	if cfg.MQTTUsername != "agent-user" {
		t.Fatalf("expected MQTT username override, got %q", cfg.MQTTUsername)
	}

	if cfg.MQTTPassword != "agent-pass" {
		t.Fatalf("expected MQTT password override, got %q", cfg.MQTTPassword)
	}

	if cfg.RetryMaxAttempts != 8 {
		t.Fatalf("expected retry max attempts override 8, got %d", cfg.RetryMaxAttempts)
	}
	if cfg.RetryInitialDelay != 3*time.Second {
		t.Fatalf("expected retry initial delay override 3s, got %s", cfg.RetryInitialDelay)
	}
	if cfg.RetryMaxDelay != 15*time.Second {
		t.Fatalf("expected retry max delay override 15s, got %s", cfg.RetryMaxDelay)
	}
	if cfg.RetryMultiplier != 1.5 {
		t.Fatalf("expected retry multiplier override 1.5, got %v", cfg.RetryMultiplier)
	}

	if !cfg.ValidateOnly {
		t.Fatal("expected validate-only mode true")
	}
}

func TestLoadFromEnvMissingRequired(t *testing.T) {
	t.Setenv("AGENT_PRINTER_ID", "")
	t.Setenv("AGENT_SPOOL_DIR", "/var/lib/leftover-agent/spool")
	t.Setenv("CUPS_PRINTER_NAME", "mockPrinter")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected missing required env error")
	}

	if !strings.Contains(err.Error(), "AGENT_PRINTER_ID") {
		t.Fatalf("expected AGENT_PRINTER_ID in error, got: %v", err)
	}
}

func TestLoadFromEnvRejectsInvalidPollInterval(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("AGENT_POLL_INTERVAL_SECONDS", "0")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid poll interval error")
	}

	if !strings.Contains(err.Error(), "AGENT_POLL_INTERVAL_SECONDS") {
		t.Fatalf("expected AGENT_POLL_INTERVAL_SECONDS in error, got: %v", err)
	}
}

func TestLoadFromEnvRejectsInvalidValidateOnly(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("AGENT_VALIDATE_ONLY", "maybe")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected AGENT_VALIDATE_ONLY parse error")
	}

	if !strings.Contains(err.Error(), "AGENT_VALIDATE_ONLY") {
		t.Fatalf("expected AGENT_VALIDATE_ONLY in error, got: %v", err)
	}
}

func TestLoadFromEnvRejectsInvalidRetryMaxAttempts(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("AGENT_RETRY_MAX_ATTEMPTS", "0")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected AGENT_RETRY_MAX_ATTEMPTS parse error")
	}

	if !strings.Contains(err.Error(), "AGENT_RETRY_MAX_ATTEMPTS") {
		t.Fatalf("expected AGENT_RETRY_MAX_ATTEMPTS in error, got: %v", err)
	}
}

func TestLoadFromEnvRejectsRetryMaxDelayLowerThanInitial(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("AGENT_RETRY_INITIAL_DELAY_SECONDS", "30")
	t.Setenv("AGENT_RETRY_MAX_DELAY_SECONDS", "10")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected retry delay ordering error")
	}

	if !strings.Contains(err.Error(), "AGENT_RETRY_MAX_DELAY_SECONDS") {
		t.Fatalf("expected AGENT_RETRY_MAX_DELAY_SECONDS in error, got: %v", err)
	}
}

func TestLoadFromEnvRejectsInvalidRetryMultiplier(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("AGENT_RETRY_MULTIPLIER", "0.5")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected AGENT_RETRY_MULTIPLIER parse error")
	}

	if !strings.Contains(err.Error(), "AGENT_RETRY_MULTIPLIER") {
		t.Fatalf("expected AGENT_RETRY_MULTIPLIER in error, got: %v", err)
	}
}

func TestLoadFromEnvMissingMQTTBroker(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("MQTT_BROKER_URL", "")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected missing MQTT_BROKER_URL error")
	}

	if !strings.Contains(err.Error(), "MQTT_BROKER_URL") {
		t.Fatalf("expected MQTT_BROKER_URL in error, got: %v", err)
	}
}

func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("AGENT_PRINTER_ID", "printer-01")
	t.Setenv("AGENT_SPOOL_DIR", "/var/lib/leftover-agent/spool")
	t.Setenv("CUPS_PRINTER_NAME", "mockPrinter")
	t.Setenv("MQTT_BROKER_URL", "mqtt://localhost:1883")
	t.Setenv("MQTT_CLIENT_ID", "printer-01")
	t.Setenv("MQTT_USERNAME", "printer-01")
	t.Setenv("MQTT_PASSWORD", "change-me-agent")
}
