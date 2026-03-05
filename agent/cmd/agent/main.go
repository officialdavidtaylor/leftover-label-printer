package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"sync"
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

	log.Printf("agent mqtt consumer starting (printer_id=%s broker=%s)", cfg.PrinterID, cfg.MQTTBrokerURL)

	err = mqttconsume.ConsumeLoop(ctx, mqttconsume.Options{
		PrinterID: cfg.PrinterID,
		Client:    client,
		Logger:    stdlibConsumeLogger{},
		OnCommand: buildPrintJobCommandHandler(commandExecutor, statusPublisher),
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
	PublishPrintJobOutcome(
		ctx context.Context,
		input mqttstatus.PublishPrintJobOutcomeInput,
	) (mqttstatus.PublishPrintJobOutcomeResult, error)
}

const maxCachedExecutionResults = 2048

func buildPrintJobCommandHandler(
	executor printCommandExecutor,
	outcomePublisher printOutcomePublisher,
) func(context.Context, mqttconsume.PrintJobCommand) error {
	var (
		mu            sync.Mutex
		cachedResults = make(map[string]jobexec.Result)
		cacheOrder    []string
	)

	return func(ctx context.Context, command mqttconsume.PrintJobCommand) error {
		if outcomePublisher == nil {
			return errors.New("print outcome publisher is required")
		}

		mu.Lock()
		result, hasCachedResult := cachedResults[command.EventID]
		mu.Unlock()
		if !hasCachedResult {
			result = executor.Execute(ctx, jobexec.Command{
				EventID:   command.EventID,
				TraceID:   command.TraceID,
				JobID:     command.JobID,
				PrinterID: command.PrinterID,
				ObjectURL: command.ObjectURL,
			})

			mu.Lock()
			if len(cachedResults) >= maxCachedExecutionResults {
				for len(cacheOrder) > 0 {
					oldestEventID := cacheOrder[0]
					cacheOrder = cacheOrder[1:]

					if _, exists := cachedResults[oldestEventID]; exists {
						delete(cachedResults, oldestEventID)
						break
					}
				}
			}
			cachedResults[command.EventID] = result
			cacheOrder = append(cacheOrder, command.EventID)
			mu.Unlock()
		}

		publishResult, err := outcomePublisher.PublishPrintJobOutcome(ctx, mqttstatus.PublishPrintJobOutcomeInput{
			TraceID:      command.TraceID,
			JobID:        command.JobID,
			PrinterID:    command.PrinterID,
			Outcome:      result.Outcome,
			ErrorCode:    result.ErrorCode,
			ErrorMessage: result.ErrorMessage,
		})
		if err != nil {
			log.Printf(
				"print outcome publish failed (printer_id=%s job_id=%s dispatch_event_id=%s trace_id=%s outcome=%s error=%v)",
				command.PrinterID,
				command.JobID,
				command.EventID,
				command.TraceID,
				result.Outcome,
				err,
			)
			return err
		}

		mu.Lock()
		delete(cachedResults, command.EventID)
		mu.Unlock()

		log.Printf(
			"print command handled (printer_id=%s job_id=%s dispatch_event_id=%s outcome_event_id=%s trace_id=%s outcome=%s occurred_at=%s error_code=%s error_message=%q lp_output=%q topic=%s)",
			command.PrinterID,
			command.JobID,
			command.EventID,
			publishResult.Payload.EventID,
			command.TraceID,
			result.Outcome,
			publishResult.Payload.OccurredAt,
			result.ErrorCode,
			result.ErrorMessage,
			result.LPOutput,
			publishResult.Topic,
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
