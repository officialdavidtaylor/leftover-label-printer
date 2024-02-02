package main

import (
	"log"
	"src/internal/server"
)

func main() {
	s := server.InitializeServer()

	log.Fatal(s.ListenAndServe())
}
