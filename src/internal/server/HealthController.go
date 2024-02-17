package server

import (
	"net/http"
)

type HealthController struct {
}

func (c *HealthController) CheckHealthHandler(w http.ResponseWriter, r *http.Request) {

	// this endpoing is just an informational endpoint; only allow GET
	if r.Method != "GET" {
		msg := "This endpoint only supports GET requests"
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success","message":"this service is operating as expected"}`))
}
