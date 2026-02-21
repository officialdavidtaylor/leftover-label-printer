package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/config"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttclient"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client, err := mqttclient.NewPahoClient(mqttclient.Config{
		BrokerURL: cfg.MQTTBrokerURL,
		ClientID:  cfg.MQTTClientID,
		Username:  cfg.MQTTUsername,
		Password:  cfg.MQTTPassword,
	})
	if err != nil {
		log.Fatalf("build mqtt client: %v", err)
	}

	log.Printf("agent mqtt consumer starting (printer_id=%s broker=%s)", cfg.PrinterID, cfg.MQTTBrokerURL)

	err = mqttconsume.ConsumeLoop(ctx, mqttconsume.Options{
		PrinterID: cfg.PrinterID,
		Client:    client,
		Logger:    stdlibConsumeLogger{},
		OnCommand: handlePrintJobCommand,
	})
	if err != nil {
		log.Fatalf("consume loop failed: %v", err)
	}

	log.Print("shutdown signal received")
}

func handlePrintJobCommand(_ context.Context, command mqttconsume.PrintJobCommand) error {
	// AG-03 handles download + lp execution; AG-02 guarantees resilient consume/reconnect + idempotent processing.
	log.Printf(
		"received print command (printer_id=%s job_id=%s event_id=%s trace_id=%s object_url=%s)",
		command.PrinterID,
		command.JobID,
		command.EventID,
		command.TraceID,
		command.ObjectURL,
	)

	return nil
}

type stdlibConsumeLogger struct{}

func (stdlibConsumeLogger) Info(event string, fields map[string]any) {
	log.Printf("event=%s level=info fields=%v", event, fields)
}

func (stdlibConsumeLogger) Warn(event string, fields map[string]any) {
	log.Printf("event=%s level=warn fields=%v", event, fields)
}
