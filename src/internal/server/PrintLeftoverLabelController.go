package server

import (
	"net/http"
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

func (c *PrintLeftoverLabelController) PrintLeftoverLabelHandler(w http.ResponseWriter, r *http.Request) {
	// todo
}
