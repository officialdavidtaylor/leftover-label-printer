// A collection of utilities and mocks
package utils

import (
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

//go:embed assets/test-label.pdf
var pdf []byte

// # Mock of the PDF generation function
//
// To induce a failure:
//   - labelText length > 64 characters
//   - labelText == "PDF GENERATION FAIL - WRITE ERROR"
func MockGeneratePdf(labelText string, dateVerb string) ([]byte, error) {
	fmt.Println("generatePdf mock function called")

	if len(labelText) > 64 {
		return nil, errors.New("labelText value too long")
	}

	if labelText == "PDF GENERATION FAIL - WRITE ERROR" {
		return nil, errors.New("error writing pdf")
	}

	return pdf, nil
}

// # Mock of the PDF printing function
//
// To induce a failure:
//   - pass a quantity >= 100
func MockPrintPdf(quantity int, filePathName string) ([]byte, error) {
	fmt.Println("printPdf mock function called")

	if quantity == 0 || quantity >= 100 {
		return []byte("exit code 5"), errors.New(fmt.Sprintf("Invalid label quantity: %v", quantity))
	}

	return []byte("exit code 0"), nil
}

type RequestParams struct {
	ReqMethod          string
	ReqBody            io.Reader
	ExpectedStatusCode int
	ExpectedMessage    string
}

func RequestTester(t *testing.T, testRequests []RequestParams, handler func(w http.ResponseWriter, r *http.Request)) {

	// convert each test case into an http request, store requests in a slice for easy iteration
	var requests []*http.Request

	for _, a := range testRequests {
		// construct a request to pass to our handler based on the params defined above
		req, err := http.NewRequest(a.ReqMethod, "/", a.ReqBody)
		if err != nil {
			t.Log(err)
			t.Fail()
		}
		requests = append(requests, req)
	}

	// record and validate the way each request is handled
	for i, r := range requests[:] {
		expectedStatusCode := testRequests[i].ExpectedStatusCode
		expectedMessage := testRequests[i].ExpectedMessage

		// We create a ResponseRecorder (which satisfies http.ResponseWriter) to record the response.
		rr := httptest.NewRecorder()
		handler := http.HandlerFunc(handler)
		// Our handlers satisfy http.Handler, so we can call their ServeHTTP method
		// directly and pass in our Request and ResponseRecorder.
		t.Logf("test: %v", i)
		handler.ServeHTTP(rr, r)
		// Check the status code is what we expect.
		if status := rr.Code; status != expectedStatusCode {
			t.Errorf("handler returned incorrect status code: got %v want %v",
				status, expectedStatusCode)
		}
		// Check the response ReqBody is what we expect.
		if rr.Body.String() != expectedMessage {
			t.Errorf("handler returned unexpected message: \ngot: %v\nwant: %v",
				rr.Body.String(), expectedMessage)
		}
	}
}
