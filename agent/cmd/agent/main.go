package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/config"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
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

	commandExecutor, err := jobexec.NewExecutor(jobexec.Config{
		SpoolDir:        cfg.SpoolDir,
		CUPSPrinterName: cfg.CUPSPrinterName,
		LPCommandPath:   cfg.LPCommandPath,
	})
	if err != nil {
		log.Fatalf("build print command executor: %v", err)
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
		OnCommand: buildPrintJobCommandHandler(commandExecutor),
	})
	if err != nil {
		log.Fatalf("consume loop failed: %v", err)
	}

	log.Print("shutdown signal received")
}

type printCommandExecutor interface {
	Execute(ctx context.Context, command jobexec.Command) jobexec.Result
}

func buildPrintJobCommandHandler(executor printCommandExecutor) func(context.Context, mqttconsume.PrintJobCommand) error {
	return func(ctx context.Context, command mqttconsume.PrintJobCommand) error {
		result := executor.Execute(ctx, jobexec.Command{
			EventID:   command.EventID,
			TraceID:   command.TraceID,
			JobID:     command.JobID,
			PrinterID: command.PrinterID,
			ObjectURL: command.ObjectURL,
		})

		log.Printf(
			"print command handled (printer_id=%s job_id=%s event_id=%s trace_id=%s outcome=%s error_code=%s error_message=%q lp_output=%q)",
			command.PrinterID,
			command.JobID,
			command.EventID,
			command.TraceID,
			result.Outcome,
			result.ErrorCode,
			result.ErrorMessage,
			result.LPOutput,
		)

		// AG-03 captures print success/failure for future status emission; returning nil avoids duplicate processing.
		return nil
	}
}

type stdlibConsumeLogger struct{}

func (stdlibConsumeLogger) Info(event string, fields map[string]any) {
	log.Printf("event=%s level=info fields=%v", event, fields)
}

func (stdlibConsumeLogger) Warn(event string, fields map[string]any) {
	log.Printf("event=%s level=warn fields=%v", event, fields)
}
