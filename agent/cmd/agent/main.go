package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/config"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobexec"
	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/jobqueue"
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
		"agent startup checks passed (printer_id=%s cups_printer=%s lp_command_path=%s spool_dir=%s retry_max_attempts=%d retry_initial_delay=%s retry_max_delay=%s retry_multiplier=%.2f)",
		cfg.PrinterID,
		cfg.CUPSPrinterName,
		cfg.LPCommandPath,
		cfg.SpoolDir,
		cfg.RetryMaxAttempts,
		cfg.RetryInitialDelay,
		cfg.RetryMaxDelay,
		cfg.RetryMultiplier,
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

	queueStore, err := jobqueue.NewStore(cfg.SpoolDir)
	if err != nil {
		log.Fatalf("build durable queue store: %v", err)
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

	queueProcessor, err := jobqueue.NewProcessor(jobqueue.ProcessorConfig{
		Store:    queueStore,
		Executor: commandExecutor,
		RetryPolicy: jobqueue.RetryPolicy{
			MaxAttempts:  cfg.RetryMaxAttempts,
			InitialDelay: cfg.RetryInitialDelay,
			MaxDelay:     cfg.RetryMaxDelay,
			Multiplier:   cfg.RetryMultiplier,
		},
		Logger:           stdlibConsumeLogger{},
		OutcomePublisher: statusPublisher,
		OutcomeOutbox:    statusOutbox,
	})
	if err != nil {
		log.Fatalf("build queue processor: %v", err)
	}

	queueWake := make(chan struct{}, 1)
	queueWorkerErr := make(chan error, 1)
	go func() {
		queueWorkerErr <- jobqueue.RunLoop(ctx, queueProcessor, cfg.PollInterval, queueWake)
		stop()
	}()

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
		OnCommand: buildPrintJobCommandHandler(queueStore, queueWake, stdlibConsumeLogger{}, time.Now),
	})

	stop()
	workerErr := <-queueWorkerErr
	if workerErr != nil {
		log.Fatalf("queue processor failed: %v", workerErr)
	}
	if err != nil {
		log.Fatalf("consume loop failed: %v", err)
	}

	log.Print("shutdown signal received")
}

type durableQueue interface {
	Enqueue(command jobexec.Command, now time.Time) (jobqueue.QueuedJob, bool, error)
}

type queueLogger interface {
	Info(event string, fields map[string]any)
	Warn(event string, fields map[string]any)
}

func buildPrintJobCommandHandler(
	queue durableQueue,
	queueWake chan<- struct{},
	logger queueLogger,
	now func() time.Time,
) func(context.Context, mqttconsume.PrintJobCommand) error {
	if now == nil {
		now = time.Now
	}

	return func(_ context.Context, command mqttconsume.PrintJobCommand) error {
		_, created, err := queue.Enqueue(jobexec.Command{
			EventID:   command.EventID,
			TraceID:   command.TraceID,
			JobID:     command.JobID,
			PrinterID: command.PrinterID,
			ObjectURL: command.ObjectURL,
		}, now())
		if err != nil {
			return err
		}

		if created {
			select {
			case queueWake <- struct{}{}:
			default:
			}

			logQueueInfo(logger, "queue_job_enqueued", map[string]any{
				"printerId": command.PrinterID,
				"jobId":     command.JobID,
				"eventId":   command.EventID,
				"traceId":   command.TraceID,
			})
			return nil
		}

		logQueueInfo(logger, "queue_job_duplicate_ignored", map[string]any{
			"printerId": command.PrinterID,
			"jobId":     command.JobID,
			"eventId":   command.EventID,
			"traceId":   command.TraceID,
		})
		return nil
	}
}

func logQueueInfo(logger queueLogger, event string, fields map[string]any) {
	if logger == nil {
		return
	}

	logger.Info(event, fields)
}

type stdlibConsumeLogger struct{}

func (stdlibConsumeLogger) Info(event string, fields map[string]any) {
	log.Printf("event=%s level=info fields=%v", event, fields)
}

func (stdlibConsumeLogger) Warn(event string, fields map[string]any) {
	log.Printf("event=%s level=warn fields=%v", event, fields)
}
