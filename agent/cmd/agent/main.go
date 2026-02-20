package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/config"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/print"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	if err := print.ValidateLPCommandPath(cfg.LPCommandPath); err != nil {
		log.Fatalf("validate print command path: %v", err)
	}

	log.Printf(
		"agent startup checks passed (printer_id=%s cups_printer=%s lp_command_path=%s)",
		cfg.PrinterID,
		cfg.CUPSPrinterName,
		cfg.LPCommandPath,
	)

	if cfg.ValidateOnly {
		log.Print("validate-only mode enabled; exiting after startup checks")
		return
	}

	runMainLoop(cfg.PollInterval)
}

func runMainLoop(pollInterval time.Duration) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	log.Printf("agent running (poll_interval=%s)", pollInterval)

	for {
		select {
		case <-ctx.Done():
			log.Print("shutdown signal received")
			return
		case <-ticker.C:
			// TODO(USE-54): Replace this placeholder poll tick with a real queue consumer loop.
			// https://linear.app/useful-code/issue/USE-54/inf-05-replace-remaining-service-stubs-and-placeholder-runtime-loops
			log.Print("poll tick: awaiting queue consumer implementation")
		}
	}
}
