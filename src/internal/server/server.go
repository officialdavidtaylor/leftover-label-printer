package server

import (
	"net/http"
	"time"
)

func InitializeServer() *http.Server {
	/* -- CONFIGURE ROUTING -- */
	mux := http.NewServeMux()

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
