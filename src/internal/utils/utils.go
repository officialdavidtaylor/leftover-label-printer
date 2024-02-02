// A collection of utilities and mocks
package utils

import (
	_ "embed"
	"errors"
	"fmt"
)

//go:embed assets/test-label.pdf
var pdf []byte

// # Mock of the PDF generation function
//
// To induce a failure:
//   - labelText length > 64 characters
//   - labelText == "PDF GENERATION FAIL - WRITE ERROR"
func MockGeneratePdf(labelText string) ([]byte, error) {
	fmt.Println("generatePdf mock function called")

	if len(labelText) > 64 {
		return nil, errors.New("labelText value too long")
	}

	if labelText == "PDF GENERATION FAIL - WRITE ERROR" {
		return nil, errors.New("Error writing PDF")
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
