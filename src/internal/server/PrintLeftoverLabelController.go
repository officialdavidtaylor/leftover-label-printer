package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type PrintLeftoverLabelController struct {
	generatePdf func(labelText string) ([]byte, error)
	printPdf    func(quantity int, filePathName string) ([]byte, error)
}

func NewPrintLeftoverLabelController(generatePdf func(lt string) ([]byte, error), printPdf func(q int, fpn string) ([]byte, error)) *PrintLeftoverLabelController {

	return &PrintLeftoverLabelController{
		generatePdf: generatePdf,
		printPdf:    printPdf,
	}
}

type PrintLabelRequestBody struct {
	LabelText string `json:"labelText"`
	Quantity  int    `json:"quantity"`
}

const FILE_PATH = "./tmp"

// the label itself can only display a few words, so 128 bytes is more than enough for a reasonable request
// yet it is small enough to very quickly recognize if the request is unreasonably large
const MAX_REQUEST_BODY_SIZE = 128

func (c *PrintLeftoverLabelController) PrintLeftoverLabelHandler(w http.ResponseWriter, r *http.Request) {
	/* -- FAIL FAST -- */

	if r.Method != "POST" {
		msg := "This endpoint only supports POST requests"
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	// ensure Content-Type "application/json"
	ct := r.Header.Get("Content-Type")
	if ct != "" {
		mediaType := strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
		if mediaType != "application/json" {
			msg := "Content-Type header is not application/json. Received: " + mediaType
			http.Error(w, msg, http.StatusUnsupportedMediaType)
			return
		}
	}

	if r.Body == nil {
		msg := "Request body not provided"
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	/* -- PARSE AND VALIDATE BODY -- */

	// limit the amount of data to be read from the body
	// this protects against hanging the app if we get an unreasonably large request body
	r.Body = http.MaxBytesReader(w, r.Body, MAX_REQUEST_BODY_SIZE)

	rb := PrintLabelRequestBody{}

	dec := json.NewDecoder(r.Body)
	defer r.Body.Close()
	dec.DisallowUnknownFields()

	err := dec.Decode(&rb)
	if err != nil {
		switch {
		case err.Error() == "http: request body too large":
			msg := "Request body is too large"
			http.Error(w, msg, http.StatusRequestEntityTooLarge)
			return
		case strings.Contains(err.Error(), `json: unknown field`):
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		default:
			msg := "Malformed request body"
			http.Error(w, msg, http.StatusBadRequest)
			return
		}
	}

	// ensure the data collected from the client passes a "stink check"
	if rb.LabelText == "" {
		msg := "no value provided for labelText"
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if rb.Quantity <= 0 {
		msg := "invalid quantity: value must be a positive integer"
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	/* -- GENERATE PDF -- */

	// ensure the directory to save the PDF to exists
	absPath, err := filepath.Abs(FILE_PATH)

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		if err := os.MkdirAll(FILE_PATH, os.ModePerm); err != nil {
			fmt.Println("failed while trying to make new path:", FILE_PATH)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}

	// use current UTC microsecond time to avoid file naming collisions
	timeStamp := time.Now().UTC().UnixMicro()
	fileName := fmt.Sprintf("%v.pdf", timeStamp)
	filePathName := filepath.Join(absPath, fileName)

	// create file in which we will write the pdf document []byte
	f, err := os.Create(filePathName)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	// TODO: integrate pdf generator
	// generate pdf document as []byte

	// TODO: integrate file writing (upon adding pdf generator)
	// write PDF data to file

	// TODO: integrate pdf printer

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
	return
}
