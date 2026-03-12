package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/config"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttclient"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttstatus"
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

	statusPublisherClient, err := mqttclient.NewPahoClient(mqttclient.Config{
		BrokerURL: cfg.MQTTBrokerURL,
		ClientID:  cfg.MQTTClientID + "-status-publisher",
		Username:  cfg.MQTTUsername,
		Password:  cfg.MQTTPassword,
	})
	if err != nil {
		log.Fatalf("build mqtt status publisher client: %v", err)
	}

	statusPublisher, err := mqttstatus.NewPublisher(mqttstatus.Config{
		Client: statusPublisherClient,
	})
	if err != nil {
		log.Fatalf("build mqtt status publisher: %v", err)
	}

	statusOutbox, err := mqttstatus.NewFileOutbox(cfg.SpoolDir)
	if err != nil {
		log.Fatalf("build mqtt status outbox: %v", err)
	}

	publishedCount, err := statusOutbox.Drain(ctx, statusPublisher)
	if err != nil {
		log.Printf("status outbox drain deferred (error=%v)", err)
	} else if publishedCount > 0 {
		log.Printf("status outbox drained pending outcomes (count=%d)", publishedCount)
	}

	log.Printf("agent mqtt consumer starting (printer_id=%s broker=%s)", cfg.PrinterID, cfg.MQTTBrokerURL)

	err = mqttconsume.ConsumeLoop(ctx, mqttconsume.Options{
		PrinterID: cfg.PrinterID,
		Client:    client,
		Logger:    stdlibConsumeLogger{},
		OnCommand: buildPrintJobCommandHandler(commandExecutor, statusPublisher, statusOutbox),
	})
	if err != nil {
		log.Fatalf("consume loop failed: %v", err)
	}

	log.Print("shutdown signal received")
}

type printCommandExecutor interface {
	Execute(ctx context.Context, command jobexec.Command) jobexec.Result
}

type printOutcomePublisher interface {
	mqttstatus.OutcomePayloadPublisher
	BuildPrintJobOutcomePayload(input mqttstatus.PublishPrintJobOutcomeInput) (mqttstatus.PrintJobOutcomePayload, error)
}

type printOutcomeOutbox interface {
	Enqueue(payload mqttstatus.PrintJobOutcomePayload) error
	Drain(ctx context.Context, publisher mqttstatus.OutcomePayloadPublisher) (int, error)
}

func buildPrintJobCommandHandler(
	executor printCommandExecutor,
	outcomePublisher printOutcomePublisher,
	outcomeOutbox printOutcomeOutbox,
) func(context.Context, mqttconsume.PrintJobCommand) error {
	return func(ctx context.Context, command mqttconsume.PrintJobCommand) error {
		if outcomePublisher == nil {
			return errors.New("print outcome publisher is required")
		}
		if outcomeOutbox == nil {
			return errors.New("print outcome outbox is required")
		}

		result := executor.Execute(ctx, jobexec.Command{
			EventID:   command.EventID,
			TraceID:   command.TraceID,
			JobID:     command.JobID,
			PrinterID: command.PrinterID,
			ObjectURL: command.ObjectURL,
		})

		payload, err := outcomePublisher.BuildPrintJobOutcomePayload(mqttstatus.PublishPrintJobOutcomeInput{
			TraceID:      command.TraceID,
			JobID:        command.JobID,
			PrinterID:    command.PrinterID,
			Outcome:      result.Outcome,
			ErrorCode:    result.ErrorCode,
			ErrorMessage: result.ErrorMessage,
		})
		if err != nil {
			return err
		}

		if err := outcomeOutbox.Enqueue(payload); err != nil {
			return err
		}

		publishedCount, err := outcomeOutbox.Drain(ctx, outcomePublisher)
		if err != nil {
			log.Printf(
				"print command queued terminal outcome for retry (printer_id=%s job_id=%s dispatch_event_id=%s outcome_event_id=%s trace_id=%s outcome=%s error=%v)",
				command.PrinterID,
				command.JobID,
				command.EventID,
				payload.EventID,
				command.TraceID,
				result.Outcome,
				err,
			)
			return nil
		}

		log.Printf(
			"print command handled (printer_id=%s job_id=%s dispatch_event_id=%s outcome_event_id=%s trace_id=%s outcome=%s occurred_at=%s error_code=%s error_message=%q lp_output=%q published_count=%d)",
			command.PrinterID,
			command.JobID,
			command.EventID,
			payload.EventID,
			command.TraceID,
			result.Outcome,
			payload.OccurredAt,
			result.ErrorCode,
			result.ErrorMessage,
			result.LPOutput,
			publishedCount,
		)

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
