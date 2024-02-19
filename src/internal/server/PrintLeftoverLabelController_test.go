package server_test

import (
	"bytes"
	"net/http"
	"src/internal/server"
	"src/internal/utils"
	"testing"
)

func TestPrintLeftoverLabelController(t *testing.T) {
	// range of test cases to iterate
	var testRequests = []utils.RequestParams{
		// should fail because incorrect HTTP method
		{
			ReqMethod:          "GET",
			ReqBody:            nil,
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "This endpoint only supports POST requests\n",
		},
		// should fail because incorrect HTTP method
		{
			ReqMethod:          "PUT",
			ReqBody:            nil,
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "This endpoint only supports POST requests\n",
		},
		// should fail because incorrect HTTP method
		{
			ReqMethod:          "CHANGE",
			ReqBody:            nil,
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "This endpoint only supports POST requests\n",
		},
		// should fail because the body is malformed
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString("some text"),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "Malformed request body\n",
		},
		// should fail because the body is missing the quantity field
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor"}`),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "invalid quantity: value must be a positive integer\n",
		},
		// should fail because the body is missing the labelText field
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"quantity":2}`),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "no value provided for labelText\n",
		},
		// should fail because the body has an additional, unknown field
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":2,"foo":"bar"}`),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "json: unknown field \"foo\"\n",
		},
		// should fail because a payload field has an incorrect type
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":2,"quantity":2}`),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "Malformed request body\n",
		},
		// should fail because payload is too large
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa.","quantity":2}`),
			ExpectedStatusCode: http.StatusRequestEntityTooLarge,
			ExpectedMessage:    "Request body is too large\n",
		},
		// should fail because quantity is zero
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":0}`),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "invalid quantity: value must be a positive integer\n",
		},
		// should fail because the dateDescriptor has too many characters
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":100, "dateDescriptor":"this is far too long:"}`),
			ExpectedStatusCode: http.StatusBadRequest,
			ExpectedMessage:    "value for dateDescriptor has too many characters: try something shorter\n",
		},
		// should fail on PDF generation
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"PDF GENERATION FAIL - WRITE ERROR","quantity":2}`),
			ExpectedStatusCode: http.StatusInternalServerError,
			ExpectedMessage:    "Error preparing label for printing\n",
		},
		// should fail on PDF printing (quantity 100 is the trigger)
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":100}`),
			ExpectedStatusCode: http.StatusInternalServerError,
			ExpectedMessage:    "Error printing label\n",
		},
		// should pass
		{
			ReqMethod:          "POST",
			ReqBody:            bytes.NewBufferString(`{"labelText":"Lorem ipsum dolor","quantity":2}`),
			ExpectedStatusCode: http.StatusOK,
			ExpectedMessage:    `{"status":"success"}`,
		},
	}

	// initialize test controller
	c := server.NewPrintLeftoverLabelController(utils.MockGeneratePdf, utils.MockPrintPdf)

	utils.RequestTester(t, testRequests, c.PrintLeftoverLabelHandler)
}
