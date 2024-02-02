package server_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"src/internal/server"
	"testing"
)

type testParams_PrintLeftoverLabelHandler struct {
	reqMethod          string
	reqBody            io.Reader
	expectedStatusCode int
	expectedMessage    string
}

// TODO: add tests once the implementation for PrintLeftoverLabelController is complete
// range of test cases to iterate
var testParams = []testParams_PrintLeftoverLabelHandler{}

func TestPrintLeftoverLabelController(t *testing.T) {

	// convert each test case into an http request, store requests in a slice for easy iteration
	var requests []*http.Request

	for _, a := range testParams {
		// construct a request to pass to our handler based on the params defined above
		req, err := http.NewRequest(a.reqMethod, "/", a.reqBody)
		if err != nil {
			t.Log(err)
			t.Fail()
		}
		requests = append(requests, req)
	}

	// TODO: integrate generatePdf functionality
	// TODO: integrate printPdf functionality
	// initialize test controller
	c := server.NewPrintLeftoverLabelController(nil, nil)

	// record and validate the way each request is handled
	for i, r := range requests[:] {
		expectedStatusCode := testParams[i].expectedStatusCode
		expectedMessage := testParams[i].expectedMessage

		// We create a ResponseRecorder (which satisfies http.ResponseWriter) to record the response.
		rr := httptest.NewRecorder()
		handler := http.HandlerFunc(c.PrintLeftoverLabelHandler)
		// Our handlers satisfy http.Handler, so we can call their ServeHTTP method
		// directly and pass in our Request and ResponseRecorder.
		t.Logf("test: %v", i)
		handler.ServeHTTP(rr, r)
		// Check the status code is what we expect.
		if status := rr.Code; status != expectedStatusCode {
			t.Errorf("handler returned incorrect status code: got %v want %v",
				status, expectedStatusCode)
		}
		// Check the response reqBody is what we expect.
		if rr.Body.String() != expectedMessage {
			t.Errorf("handler returned unexpected message: \ngot: %v\nwant: %v",
				rr.Body.String(), expectedMessage)
		}
	}
}
