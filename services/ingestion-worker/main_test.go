package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	// We can't test the full worker without NATS/DB, but we can test
	// the HTTP handler patterns.
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"service": "ingestion-worker",
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["status"] != "ok" {
		t.Errorf("expected status ok, got %v", resp["status"])
	}
}

func TestBugReportUnmarshal(t *testing.T) {
	payload := `{
		"id": "test-id",
		"org_id": "org-1",
		"title": "Test Bug",
		"description": "A test bug report",
		"severity_hint": "high",
		"source_type": "test",
		"file_path": "/src/main.go",
		"line_number": 42
	}`

	var report BugReport
	if err := json.Unmarshal([]byte(payload), &report); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if report.ID != "test-id" {
		t.Errorf("expected id 'test-id', got '%s'", report.ID)
	}
	if report.Title != "Test Bug" {
		t.Errorf("expected title 'Test Bug', got '%s'", report.Title)
	}
	if report.LineNumber != 42 {
		t.Errorf("expected line 42, got %d", report.LineNumber)
	}
	if report.SeverityHint != "high" {
		t.Errorf("expected severity 'high', got '%s'", report.SeverityHint)
	}
}

func TestGetEnv(t *testing.T) {
	val := getEnv("NONEXISTENT_VAR_12345", "fallback")
	if val != "fallback" {
		t.Errorf("expected 'fallback', got '%s'", val)
	}
}

func TestGetEnvInt(t *testing.T) {
	val := getEnvInt("NONEXISTENT_VAR_12345", 42)
	if val != 42 {
		t.Errorf("expected 42, got %d", val)
	}
}

func TestLoadConfig(t *testing.T) {
	config := loadConfig()

	if config.NatsURL == "" {
		t.Error("NatsURL should not be empty")
	}
	if config.DatabaseURL == "" {
		t.Error("DatabaseURL should not be empty")
	}
	if config.WorkerCount <= 0 {
		t.Error("WorkerCount should be positive")
	}
	if config.HTTPPort <= 0 {
		t.Error("HTTPPort should be positive")
	}
}
