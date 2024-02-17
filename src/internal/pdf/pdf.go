package pdf

import (
	"bytes"
	_ "embed"
	"errors"
	"time"

	"github.com/signintech/gopdf"
)

const (
	PAGE_WIDTH  = 162
	PAGE_HEIGHT = 90
	PAGE_MARGIN = 10
)

//go:embed fonts/Rubik-Regular.ttf
var rubikRegular []byte

// Generate a PDF document consisting of the provided `labelText` and the current date
func GeneratePdf(labelText string) ([]byte, error) {
	// initialize PDF
	pdf := gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: gopdf.Rect{W: PAGE_WIDTH, H: PAGE_HEIGHT}})
	pdf.AddPage()

	// load the (embedded) font file for adding text to the document
	rr := bytes.NewReader(rubikRegular)
	err := pdf.AddTTFFontByReader("Rubik-Regular", rr)
	if err != nil {
		return nil, err
	}

	err = pdf.SetFont("Rubik-Regular", "", 16)
	if err != nil {
		return nil, err
	}

	// write the label text in the upper-left corner of the document
	pdf.SetXY(PAGE_MARGIN, 10)
	pdf.SetTextColor(0, 0, 0)
	err = pdf.SetFont("Rubik-Regular", "", 16)
	if err != nil {
		return nil, err
	}
	err = pdf.Cell(nil, labelText)
	if err != nil {
		return nil, err
	}

	// write the "made on" date information in the lower-left corner of the document
	pdf.SetXY(PAGE_MARGIN, 57)
	pdf.SetTextColor(85, 85, 85)
	err = pdf.SetFont("Rubik-Regular", "", 10)
	if err != nil {
		return nil, err
	}
	err = pdf.Cell(nil, "made:")
	if err != nil {
		return nil, err
	}

	pdf.SetXY(PAGE_MARGIN, 69)
	pdf.SetTextColor(0, 0, 0)
	err = pdf.SetFont("Rubik-Regular", "", 12)
	if err != nil {
		return nil, err
	}
	err = pdf.Cell(nil, time.Now().Local().Format(time.DateOnly))
	if err != nil {
		return nil, err
	}

	// write the document to a byte buffer
	b := bytes.NewBuffer([]byte{})
	if n, err := pdf.WriteTo(b); err != nil || n == 0 {
		return nil, errors.New("Error writing PDF; " + err.Error())
	}

	return b.Bytes(), nil
}
