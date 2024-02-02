// Functions that interact with the underlying Linux system
//
// These functions allow for interacting with CLI programs or the OS directly.
package system

import (
	"fmt"
	"os/exec"
	"path/filepath"
)

// use system commands to print document at given filepath
func PrintPdf(quantity int, filePathName string) ([]byte, error) {

	filePathName, err := filepath.Abs(filePathName)
	if err != nil {
		return nil, err
	}

	// use linux "lp" program to print the newly minted PDF
	return exec.Command("lp",
		"-n", fmt.Sprint(quantity),
		"-o",
		"Collate=True",
		"-d", "dymo",
		filePathName,
	).Output()
}
