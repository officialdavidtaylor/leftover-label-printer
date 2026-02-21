package print

import (
	"fmt"
	"os"
	"strings"
)

func ValidateLPCommandPath(path string) error {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return fmt.Errorf("LP_COMMAND_PATH cannot be empty")
	}

	pathInfo, err := os.Stat(trimmedPath)
	if err != nil {
		return fmt.Errorf("stat LP_COMMAND_PATH %q: %w", trimmedPath, err)
	}

	if pathInfo.IsDir() {
		return fmt.Errorf("LP_COMMAND_PATH %q points to a directory", trimmedPath)
	}

	if pathInfo.Mode()&0o111 == 0 {
		return fmt.Errorf("LP_COMMAND_PATH %q is not executable", trimmedPath)
	}

	return nil
}
