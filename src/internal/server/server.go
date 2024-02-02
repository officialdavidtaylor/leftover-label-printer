package server

import (
	"net/http"
	"src/internal/pdf"
	"src/internal/system"
	"time"
)

func InitializeServer() *http.Server {
	/* -- INITIALIZE CONTROLLERS -- */
	c := NewPrintLeftoverLabelController(pdf.GeneratePdf, system.PrintPdf)

	/* -- CONFIGURE ROUTING -- */
	mux := http.NewServeMux()

	/* ENDPOINTS */
	// handle label print requests
	mux.HandleFunc("/api/v1/print-leftover-label", c.PrintLeftoverLabelHandler)

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
