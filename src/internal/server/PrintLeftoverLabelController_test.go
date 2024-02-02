package server_test

import (
	"bytes"
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

// range of test cases to iterate
var testParams = []testParams_PrintLeftoverLabelHandler{
	// should fail because incorrect HTTP method
	{
		reqMethod:          "GET",
		reqBody:            nil,
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "This endpoint only supports POST requests\n",
	},
	// should fail because incorrect HTTP method
	{
		reqMethod:          "PUT",
		reqBody:            nil,
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "This endpoint only supports POST requests\n",
	},
	// should fail because incorrect HTTP method
	{
		reqMethod:          "CHANGE",
		reqBody:            nil,
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "This endpoint only supports POST requests\n",
	},
	// should fail because the body is malformed
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString("some text"),
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "Malformed request body\n",
	},
	// should fail because the body is missing the quantity field
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor"}`),
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "invalid quantity: value must be a positive integer\n",
	},
	// should fail because the body is missing the labelText field
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"quantity":2}`),
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "no value provided for labelText\n",
	},
	// should fail because the body has an additional, unknown field
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":2,"foo":"bar"}`),
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "json: unknown field \"foo\"\n",
	},
	// should fail because a payload field has an incorrect type
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"labelText":2,"quantity":2}`),
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "Malformed request body\n",
	},
	// should fail because payload is too large
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa.","quantity":2}`),
		expectedStatusCode: http.StatusRequestEntityTooLarge,
		expectedMessage:    "Request body is too large\n",
	},
	// should fail because quantity is zero
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":0}`),
		expectedStatusCode: http.StatusBadRequest,
		expectedMessage:    "invalid quantity: value must be a positive integer\n",
	},
	// should pass
	{
		reqMethod:          "POST",
		reqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":2}`),
		expectedStatusCode: http.StatusOK,
		expectedMessage:    `{"status":"success"}`,
	},
}

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
