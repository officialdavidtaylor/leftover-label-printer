package pdf

import (
	"bytes"
	_ "embed"
	"errors"
	"time"

	"github.com/signintech/gopdf"
)

const (
	PAGE_WIDTH  = 153
	PAGE_HEIGHT = 72
	PAGE_MARGIN = 8
)

//go:embed fonts/PermanentMarker-Regular.ttf
var permanentMarkerRegular []byte

//go:embed fonts/Rubik-Regular.ttf
var rubikRegular []byte

const DEFAULT_DATE_DESCRIPTOR = "made:"

// Generate a PDF document consisting of the provided `labelText`, optional `dateDescriptor`, and the current date
func GeneratePdf(labelText string, dateDescriptor string) ([]byte, error) {

	// ensure dateDescriptor isn't empty: if not provided, set to the default value
	if dateDescriptor == "" {
		dateDescriptor = DEFAULT_DATE_DESCRIPTOR
	}

	// initialize PDF
	pdf := gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: gopdf.Rect{W: PAGE_WIDTH, H: PAGE_HEIGHT}})
	pdf.AddPage()

	// load the (embedded) font file for adding text to the document
	pmr := bytes.NewReader(permanentMarkerRegular)
	err := pdf.AddTTFFontByReader("PermanentMarker-Regular", pmr)
	if err != nil {
		return nil, err
	}
	rr := bytes.NewReader(rubikRegular)
	err = pdf.AddTTFFontByReader("Rubik-Regular", rr)
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
	err = pdf.SetFont("PermanentMarker-Regular", "", 14)
	if err != nil {
		return nil, err
	}
	err = pdf.Cell(nil, labelText)
	if err != nil {
		return nil, err
	}

	// describe what the date information corresponds to (made, bought, etc) in the lower-left corner of the document
	pdf.SetXY(PAGE_MARGIN, 43)
	pdf.SetTextColor(85, 85, 85)
	err = pdf.SetFont("Rubik-Regular", "", 10)
	if err != nil {
		return nil, err
	}
	err = pdf.Cell(nil, dateDescriptor)
	if err != nil {
		return nil, err
	}

	pdf.SetXY(PAGE_MARGIN, 55)
	pdf.SetTextColor(0, 0, 0)
	err = pdf.SetFont("Rubik-Regular", "", 10)
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
