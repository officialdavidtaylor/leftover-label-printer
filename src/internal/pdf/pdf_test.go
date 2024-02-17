package pdf_test

import (
	"fmt"
	"os"
	"path/filepath"
	"src/internal/pdf"
	"testing"
	"time"
)

const FILE_PATH = "./tmp"

// Test a simple label with input that should definitely work
func TestPdfGeneration_Simple(t *testing.T) {
	// define test value(s)
	labelText := "Lorem ipsum dolor"
	dateVerb := "bought:"

	// generate PDF as []byte
	b, err := pdf.GeneratePdf(labelText, dateVerb)
	if err != nil {
		t.Log("Failed to generate PDF", err.Error())
		t.Fail()
	}

	// define target filePath
	timeStamp := time.Now().UTC().UnixNano()
	fileName := fmt.Sprintf("%v.pdf", timeStamp)
	filePathName := filepath.Join(FILE_PATH, fileName)
	if err != nil {
		// if this fails, it's not an issue with the function we're using, but rather the test code itself
		t.Log("[meta] test error - unable to generate filename:", err.Error())
		t.Fail()
	}

	// create new file to save []byte, ensure the new file is empty
	f, err := os.Create(filePathName)
	if err != nil {
		t.Log("Error creating filepath:", err.Error())
		t.Fail()
	} else if i, err := f.Stat(); err != nil || i.Size() != 0 {
		t.Log("[meta] test error - new file has non-zero size?", err.Error())
		t.Fail()
	}
	defer f.Close()

	// write pdf data to new file
	if n, err := f.Write(b); err != nil || n == 0 {
		t.Log("Failure writing file:", err.Error())
		t.Fail()
	}

	// validate the file size is no longer 0, implying the write was successful (at least partially)
	i, err := f.Stat()
	if err != nil || i.Size() == 0 {
		t.Log("Error writing file, file size == 0.", err.Error())
		t.Fail()
	}
}
