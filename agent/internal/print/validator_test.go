package print

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateLPCommandPathAcceptsExecutableFile(t *testing.T) {
	executable := filepath.Join(t.TempDir(), "lp")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write executable: %v", err)
	}

	if err := ValidateLPCommandPath(executable); err != nil {
		t.Fatalf("expected executable to validate, got error: %v", err)
	}
}

func TestValidateLPCommandPathRejectsNonExecutableFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "lp")
	if err := os.WriteFile(file, []byte("lp"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	err := ValidateLPCommandPath(file)
	if err == nil {
		t.Fatal("expected non-executable file to fail validation")
	}

	if !strings.Contains(err.Error(), "not executable") {
		t.Fatalf("expected not executable error, got: %v", err)
	}
}

func TestValidateLPCommandPathRejectsDirectory(t *testing.T) {
	err := ValidateLPCommandPath(t.TempDir())
	if err == nil {
		t.Fatal("expected directory path to fail validation")
	}

	if !strings.Contains(err.Error(), "directory") {
		t.Fatalf("expected directory error, got: %v", err)
	}
}

func TestValidateLPCommandPathRejectsMissingPath(t *testing.T) {
	err := ValidateLPCommandPath(filepath.Join(t.TempDir(), "missing-lp"))
	if err == nil {
		t.Fatal("expected missing path to fail validation")
	}

	if !strings.Contains(err.Error(), "stat LP_COMMAND_PATH") {
		t.Fatalf("expected stat error, got: %v", err)
	}
}

func TestValidateLPCommandPathRejectsEmptyValue(t *testing.T) {
	err := ValidateLPCommandPath("   ")
	if err == nil {
		t.Fatal("expected empty path to fail validation")
	}

	if !strings.Contains(err.Error(), "cannot be empty") {
		t.Fatalf("expected empty-value error, got: %v", err)
	}
}
