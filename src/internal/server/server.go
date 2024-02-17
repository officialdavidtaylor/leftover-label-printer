package server

import (
	"net/http"
	"src/internal/pdf"
	"src/internal/system"
	"time"
)

func InitializeServer() *http.Server {
	/* -- INITIALIZE CONTROLLERS -- */
	healthController := HealthController{}
	printController := NewPrintLeftoverLabelController(pdf.GeneratePdf, system.PrintPdf)

	/* -- CONFIGURE ROUTING -- */
	mux := http.NewServeMux()

	/* ENDPOINTS */
	// handle health checks
	mux.HandleFunc("/api/v1/health", healthController.CheckHealthHandler)
	// handle label print requests
	mux.HandleFunc("/api/v1/print-leftover-label", printController.PrintLeftoverLabelHandler)

	/* -- DEFINE SERVER PROPERTIES -- */
	s := &http.Server{
		Addr:           ":4000",
		Handler:        mux,
		ReadTimeout:    10 * time.Second,
		WriteTimeout:   10 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	return s
}
