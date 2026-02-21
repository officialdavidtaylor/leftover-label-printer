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

	if !cfg.ValidateOnly {
		t.Fatal("expected validate-only mode true")
	}
}

func TestLoadFromEnvMissingRequired(t *testing.T) {
	t.Setenv("AGENT_PRINTER_ID", "")
	t.Setenv("AGENT_SPOOL_DIR", "/var/lib/leftover-agent/spool")
	t.Setenv("CUPS_PRINTER_NAME", "dymo")

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
	t.Setenv("CUPS_PRINTER_NAME", "dymo")
	t.Setenv("MQTT_BROKER_URL", "mqtt://localhost:1883")
	t.Setenv("MQTT_CLIENT_ID", "printer-01")
	t.Setenv("MQTT_USERNAME", "printer-01")
	t.Setenv("MQTT_PASSWORD", "change-me-agent")
}
