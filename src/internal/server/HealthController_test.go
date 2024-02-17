package server

import (
	"net/http"
	"src/internal/utils"
	"testing"
)

// Validate the functioning of the `/health` endpoint
func TestCheckHealthHandler(t *testing.T) {
	var testRequests = []utils.RequestParams{
		// should fail because incorrect HTTP method
		{
			ReqMethod:          "POST",
			ReqBody:            nil,
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "This endpoint only supports GET requests\n",
		},
		// should pass
		{
			ReqMethod:          "GET",
			ReqBody:            nil,
			ExpectedStatusCode: http.StatusOK,
			ExpectedMessage:    `{"status":"success","message":"this service is operating as expected"}`,
		},
	}

	c := HealthController{}

	utils.RequestTester(t, testRequests, c.CheckHealthHandler)
}
