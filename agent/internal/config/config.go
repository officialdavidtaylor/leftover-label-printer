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
)

// Config contains runtime values needed to initialize the edge agent process.
type Config struct {
	PrinterID       string
	SpoolDir        string
	CUPSPrinterName string
	PollInterval    time.Duration
	LPCommandPath   string
	ValidateOnly    bool
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
