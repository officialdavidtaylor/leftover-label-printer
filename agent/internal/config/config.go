package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPollIntervalSeconds = 10
	defaultLPCommandPath       = "/usr/bin/lp"
	defaultRetryMaxAttempts    = 5
	defaultRetryInitialDelayS  = 5
	defaultRetryMaxDelayS      = 60
	defaultRetryMultiplier     = 2.0
)

// Config contains runtime values needed to initialize the edge agent process.
type Config struct {
	PrinterID         string
	SpoolDir          string
	CUPSPrinterName   string
	PollInterval      time.Duration
	LPCommandPath     string
	MQTTBrokerURL     string
	MQTTClientID      string
	MQTTUsername      string
	MQTTPassword      string
	RetryMaxAttempts  int
	RetryInitialDelay time.Duration
	RetryMaxDelay     time.Duration
	RetryMultiplier   float64
	ValidateOnly      bool
}

func LoadFromEnv() (Config, error) {
	cfg := Config{}

	printerID, err := requiredEnv("AGENT_PRINTER_ID")
	if err != nil {
		return Config{}, err
	}
	cfg.PrinterID = printerID

	spoolDir, err := requiredEnv("AGENT_SPOOL_DIR")
	if err != nil {
		return Config{}, err
	}
	cfg.SpoolDir = spoolDir

	cupsPrinterName, err := requiredEnv("CUPS_PRINTER_NAME")
	if err != nil {
		return Config{}, err
	}
	cfg.CUPSPrinterName = cupsPrinterName

	pollIntervalSecondsRaw := strings.TrimSpace(os.Getenv("AGENT_POLL_INTERVAL_SECONDS"))
	if pollIntervalSecondsRaw == "" {
		cfg.PollInterval = defaultPollIntervalSeconds * time.Second
	} else {
		pollIntervalSeconds, parseErr := strconv.Atoi(pollIntervalSecondsRaw)
		if parseErr != nil || pollIntervalSeconds < 1 {
			return Config{}, fmt.Errorf("AGENT_POLL_INTERVAL_SECONDS must be a positive integer: %q", pollIntervalSecondsRaw)
		}

		cfg.PollInterval = time.Duration(pollIntervalSeconds) * time.Second
	}

	lpCommandPath := strings.TrimSpace(os.Getenv("LP_COMMAND_PATH"))
	if lpCommandPath == "" {
		lpCommandPath = defaultLPCommandPath
	}
	cfg.LPCommandPath = lpCommandPath

	mqttBrokerURL, err := requiredEnv("MQTT_BROKER_URL")
	if err != nil {
		return Config{}, err
	}
	cfg.MQTTBrokerURL = mqttBrokerURL

	mqttClientID, err := requiredEnv("MQTT_CLIENT_ID")
	if err != nil {
		return Config{}, err
	}
	cfg.MQTTClientID = mqttClientID

	mqttUsername, err := requiredEnv("MQTT_USERNAME")
	if err != nil {
		return Config{}, err
	}
	cfg.MQTTUsername = mqttUsername

	mqttPassword, err := requiredEnv("MQTT_PASSWORD")
	if err != nil {
		return Config{}, err
	}
	cfg.MQTTPassword = mqttPassword

	retryMaxAttemptsRaw := strings.TrimSpace(os.Getenv("AGENT_RETRY_MAX_ATTEMPTS"))
	if retryMaxAttemptsRaw == "" {
		cfg.RetryMaxAttempts = defaultRetryMaxAttempts
	} else {
		retryMaxAttempts, parseErr := strconv.Atoi(retryMaxAttemptsRaw)
		if parseErr != nil || retryMaxAttempts < 1 {
			return Config{}, fmt.Errorf("AGENT_RETRY_MAX_ATTEMPTS must be a positive integer: %q", retryMaxAttemptsRaw)
		}
		cfg.RetryMaxAttempts = retryMaxAttempts
	}

	retryInitialDelayRaw := strings.TrimSpace(os.Getenv("AGENT_RETRY_INITIAL_DELAY_SECONDS"))
	if retryInitialDelayRaw == "" {
		cfg.RetryInitialDelay = defaultRetryInitialDelayS * time.Second
	} else {
		retryInitialDelaySeconds, parseErr := strconv.Atoi(retryInitialDelayRaw)
		if parseErr != nil || retryInitialDelaySeconds < 1 {
			return Config{}, fmt.Errorf("AGENT_RETRY_INITIAL_DELAY_SECONDS must be a positive integer: %q", retryInitialDelayRaw)
		}
		cfg.RetryInitialDelay = time.Duration(retryInitialDelaySeconds) * time.Second
	}

	retryMaxDelayRaw := strings.TrimSpace(os.Getenv("AGENT_RETRY_MAX_DELAY_SECONDS"))
	if retryMaxDelayRaw == "" {
		cfg.RetryMaxDelay = defaultRetryMaxDelayS * time.Second
	} else {
		retryMaxDelaySeconds, parseErr := strconv.Atoi(retryMaxDelayRaw)
		if parseErr != nil || retryMaxDelaySeconds < 1 {
			return Config{}, fmt.Errorf("AGENT_RETRY_MAX_DELAY_SECONDS must be a positive integer: %q", retryMaxDelayRaw)
		}
		cfg.RetryMaxDelay = time.Duration(retryMaxDelaySeconds) * time.Second
	}

	if cfg.RetryMaxDelay < cfg.RetryInitialDelay {
		return Config{}, fmt.Errorf(
			"AGENT_RETRY_MAX_DELAY_SECONDS must be greater than or equal to AGENT_RETRY_INITIAL_DELAY_SECONDS (%d < %d)",
			int(cfg.RetryMaxDelay/time.Second),
			int(cfg.RetryInitialDelay/time.Second),
		)
	}

	retryMultiplierRaw := strings.TrimSpace(os.Getenv("AGENT_RETRY_MULTIPLIER"))
	if retryMultiplierRaw == "" {
		cfg.RetryMultiplier = defaultRetryMultiplier
	} else {
		retryMultiplier, parseErr := strconv.ParseFloat(retryMultiplierRaw, 64)
		if parseErr != nil || retryMultiplier < 1 {
			return Config{}, fmt.Errorf("AGENT_RETRY_MULTIPLIER must be a number greater than or equal to 1: %q", retryMultiplierRaw)
		}
		cfg.RetryMultiplier = retryMultiplier
	}

	validateOnlyRaw := strings.TrimSpace(os.Getenv("AGENT_VALIDATE_ONLY"))
	if validateOnlyRaw == "" {
		cfg.ValidateOnly = false
	} else {
		validateOnly, parseErr := strconv.ParseBool(validateOnlyRaw)
		if parseErr != nil {
			return Config{}, fmt.Errorf("AGENT_VALIDATE_ONLY must be parseable as bool: %q", validateOnlyRaw)
		}
		cfg.ValidateOnly = validateOnly
	}

	return cfg, nil
}

func requiredEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("missing required env var %s", key)
	}

	return value, nil
}
