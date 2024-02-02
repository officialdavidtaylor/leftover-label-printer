package server

import (
	"net/http"
	"time"
)

func InitializeServer() *http.Server {
	/* -- INITIALIZE CONTROLLERS -- */
	// TODO: replace nil values with functions once implemented
	c := NewPrintLeftoverLabelController(nil, nil)

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
