package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"go.uber.org/zap"
)

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

type Config struct {
	NatsURL      string
	DatabaseURL  string
	S3Bucket     string
	S3Region     string
	S3Endpoint   string
	WorkerCount  int
	BatchSize    int
	FlushTimeout time.Duration
	HTTPPort     int
}

func loadConfig() Config {
	// Render sets PORT; fallback to HTTP_PORT for local dev
	httpPort := getEnvInt("PORT", 0)
	if httpPort == 0 {
		httpPort = getEnvInt("HTTP_PORT", 8080)
	}
	return Config{
		NatsURL:      getEnv("NATS_URL", ""),
		DatabaseURL:  getEnv("DATABASE_URL", "postgres://ebug:ebug@localhost:5432/ebug?sslmode=disable"),
		S3Bucket:     getEnv("S3_BUCKET", "ebug-storage"),
		S3Region:     getEnv("S3_REGION", "us-east-1"),
		S3Endpoint:   getEnv("S3_ENDPOINT", "http://localhost:9000"),
		WorkerCount:  getEnvInt("WORKER_COUNT", 5),
		BatchSize:    getEnvInt("BATCH_SIZE", 100),
		FlushTimeout: time.Duration(getEnvInt("FLUSH_TIMEOUT_MS", 1000)) * time.Millisecond,
		HTTPPort:     httpPort,
	}
}

// ─────────────────────────────────────────────
// Bug Report DTO
// ─────────────────────────────────────────────

type BugReport struct {
	ID                  string            `json:"id"`
	ExternalID          string            `json:"external_id"`
	OrgID               string            `json:"org_id"`
	SourceType          string            `json:"source_type"`
	SourceIDE           string            `json:"source_ide"`
	SourcePluginVersion string            `json:"source_plugin_version"`
	Title               string            `json:"title"`
	Description         string            `json:"description"`
	StackTrace          string            `json:"stack_trace"`
	FilePath            string            `json:"file_path"`
	LineNumber          int               `json:"line_number"`
	CodeSnippet         string            `json:"code_snippet"`
	SeverityHint        string            `json:"severity_hint"`
	CategoryHint        string            `json:"category_hint"`
	Environment         map[string]string `json:"environment"`
	LogBlobKeys         []string          `json:"log_blob_keys"`
	ScreenshotKeys      []string          `json:"screenshot_keys"`
	CreatedBy           string            `json:"created_by"`
	CreatedAt           time.Time         `json:"created_at"`
}

// ─────────────────────────────────────────────
// Ingestion Worker
// ─────────────────────────────────────────────

type Worker struct {
	config     Config
	db         *pgxpool.Pool
	nc         *nats.Conn
	js         nats.JetStreamContext
	logger     *zap.Logger
	seqCounter atomic.Int64
	ready      atomic.Bool
	bugsCount  atomic.Int64
}

func NewWorker(config Config) (*Worker, error) {
	logger, _ := zap.NewProduction()

	// Connect to PostgreSQL
	dbPool, err := pgxpool.New(context.Background(), config.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	w := &Worker{
		config: config,
		db:     dbPool,
		logger: logger,
	}

	// Connect to NATS (optional — skip if URL is empty)
	if config.NatsURL == "" {
		logger.Warn("NATS_URL is empty — running in HTTP-only mode (no event streaming)")
		return w, nil
	}

	nc, err := nats.Connect(config.NatsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(5),
		nats.ReconnectWait(time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			logger.Warn("NATS disconnected", zap.Error(err))
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			logger.Info("NATS reconnected")
		}),
	)
	if err != nil {
		logger.Warn("NATS not available — running without event streaming", zap.Error(err))
		return w, nil
	}

	// Initialize JetStream
	js, err := nc.JetStream()
	if err != nil {
		logger.Warn("JetStream not available", zap.Error(err))
		return w, nil
	}

	// Ensure stream exists
	_, err = js.AddStream(&nats.StreamConfig{
		Name:     "BUGS",
		Subjects: []string{"bug.>"},
		Storage:  nats.FileStorage,
		MaxAge:   30 * 24 * time.Hour,
		MaxBytes: 10 * 1024 * 1024 * 1024,
	})
	if err != nil {
		logger.Warn("Stream may already exist", zap.Error(err))
	}

	w.nc = nc
	w.js = js
	return w, nil
}

func (w *Worker) Start(ctx context.Context) error {
	w.logger.Info("Starting ingestion worker",
		zap.Int("workers", w.config.WorkerCount),
		zap.String("nats", w.config.NatsURL),
	)

	// Start health/readiness HTTP server
	go w.startHTTPServer(ctx)

	// Mark as ready (health server is up)
	w.ready.Store(true)

	// If NATS is not available, just run the health server
	if w.js == nil {
		w.logger.Info("Running in HTTP-only mode (no NATS). Health server active.")
		<-ctx.Done()
		w.logger.Info("Shutting down ingestion worker")
		w.ready.Store(false)
		w.db.Close()
		return nil
	}

	// Subscribe to incoming bug reports from the API gateway
	sub, err := w.js.QueueSubscribe(
		"bug.ingest.request",
		"ingestion-workers",
		w.handleIngestRequest,
		nats.ManualAck(),
		nats.AckWait(30*time.Second),
		nats.MaxDeliver(5),
	)
	if err != nil {
		return fmt.Errorf("failed to subscribe: %w", err)
	}

	// Subscribe to telemetry events
	teleSub, err := w.js.QueueSubscribe(
		"bug.telemetry.ingest",
		"ingestion-workers",
		w.handleTelemetryEvent,
		nats.ManualAck(),
		nats.AckWait(10*time.Second),
	)
	if err != nil {
		return fmt.Errorf("failed to subscribe to telemetry: %w", err)
	}

	w.logger.Info("Ingestion worker started, listening for events")

	<-ctx.Done()

	w.logger.Info("Shutting down ingestion worker")
	w.ready.Store(false)
	sub.Unsubscribe()
	teleSub.Unsubscribe()
	w.nc.Close()
	w.db.Close()

	return nil
}

// ─────────────────────────────────────────────
// Health & Readiness HTTP Server
// ─────────────────────────────────────────────

func (w *Worker) startHTTPServer(ctx context.Context) {
	mux := http.NewServeMux()

	// Liveness probe — returns 200 if process is alive
	mux.HandleFunc("/health", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		json.NewEncoder(rw).Encode(map[string]interface{}{
			"status":    "ok",
			"service":   "ingestion-worker",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Readiness probe — returns 200 only when worker is fully initialized
	mux.HandleFunc("/ready", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		if !w.ready.Load() {
			rw.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(rw).Encode(map[string]string{
				"status": "not_ready",
			})
			return
		}

		// Verify dependencies
		if err := w.db.Ping(context.Background()); err != nil {
			rw.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(rw).Encode(map[string]string{
				"status": "db_unavailable",
			})
			return
		}

		if !w.nc.IsConnected() {
			rw.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(rw).Encode(map[string]string{
				"status": "nats_disconnected",
			})
			return
		}

		rw.WriteHeader(http.StatusOK)
		json.NewEncoder(rw).Encode(map[string]interface{}{
			"status":       "ready",
			"nats":         w.nc.IsConnected(),
			"db":           true,
			"bugs_ingested": w.bugsCount.Load(),
		})
	})

	// Metrics endpoint
	mux.HandleFunc("/metrics", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		json.NewEncoder(rw).Encode(map[string]interface{}{
			"bugs_ingested":  w.bugsCount.Load(),
			"nats_connected": w.nc.IsConnected(),
			"uptime_seconds": time.Since(time.Now()).Seconds(),
		})
	})

	addr := fmt.Sprintf(":%d", w.config.HTTPPort)
	server := &http.Server{Addr: addr, Handler: mux}

	w.logger.Info("Health HTTP server starting", zap.String("addr", addr))

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			w.logger.Error("HTTP server error", zap.Error(err))
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(shutdownCtx)
}

// ─────────────────────────────────────────────
// Message Handlers
// ─────────────────────────────────────────────

func (w *Worker) handleIngestRequest(msg *nats.Msg) {
	var report BugReport
	if err := json.Unmarshal(msg.Data, &report); err != nil {
		w.logger.Error("Failed to unmarshal bug report", zap.Error(err))
		msg.Nak()
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Generate IDs
	if report.ID == "" {
		report.ID = uuid.New().String()
	}
	seq := w.seqCounter.Add(1)
	report.ExternalID = fmt.Sprintf("EBUG-%04d", seq)
	report.CreatedAt = time.Now().UTC()

	// Upload log blobs and screenshots to S3/MinIO (best-effort)
	if len(report.LogBlobKeys) > 0 || len(report.ScreenshotKeys) > 0 {
		w.uploadBlobs(ctx, report.ID, report.LogBlobKeys, "logs")
		w.uploadBlobs(ctx, report.ID, report.ScreenshotKeys, "screenshots")
	}

	// Persist to PostgreSQL
	if err := w.persistBug(ctx, &report); err != nil {
		w.logger.Error("Failed to persist bug", zap.Error(err), zap.String("id", report.ID))
		msg.Nak()
		return
	}

	// Publish "bug.created" event for downstream consumers
	eventData, _ := json.Marshal(report)
	if _, err := w.js.Publish("bug.created", eventData); err != nil {
		w.logger.Error("Failed to publish bug.created", zap.Error(err))
		// Don't NAK — the bug is persisted, downstream can catch up
	}

	w.bugsCount.Add(1)
	w.logger.Info("Bug ingested",
		zap.String("id", report.ID),
		zap.String("external_id", report.ExternalID),
		zap.String("source", report.SourceType),
	)

	msg.Ack()
}

// uploadBlobs stores blob data in S3/MinIO under the bug's directory.
// Keys are expected to be base64-encoded content or pre-signed references.
func (w *Worker) uploadBlobs(ctx context.Context, bugID string, keys []string, subdir string) {
	if len(keys) == 0 {
		return
	}

	endpoint := w.config.S3Endpoint
	bucket := w.config.S3Bucket

	for i, key := range keys {
		objectKey := fmt.Sprintf("bugs/%s/%s/%d_%s", bugID, subdir, i, key)

		// Create S3-compatible upload request to MinIO
		uploadURL := fmt.Sprintf("%s/%s/%s", endpoint, bucket, objectKey)
		req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, nil)
		if err != nil {
			w.logger.Warn("Failed to create S3 upload request",
				zap.String("key", objectKey), zap.Error(err))
			continue
		}

		req.Header.Set("Content-Type", "application/octet-stream")

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			w.logger.Warn("S3 upload failed",
				zap.String("key", objectKey), zap.Error(err))
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			w.logger.Debug("Blob uploaded",
				zap.String("key", objectKey), zap.Int("status", resp.StatusCode))
		} else {
			w.logger.Warn("S3 upload non-200 response",
				zap.String("key", objectKey), zap.Int("status", resp.StatusCode))
		}
	}
}

func (w *Worker) handleTelemetryEvent(msg *nats.Msg) {
	// Telemetry events are best-effort — log and ack
	w.logger.Debug("Telemetry event received", zap.Int("bytes", len(msg.Data)))
	msg.Ack()
}

// ─────────────────────────────────────────────
// Database Operations
// ─────────────────────────────────────────────

func (w *Worker) persistBug(ctx context.Context, report *BugReport) error {
	envJSON, _ := json.Marshal(report.Environment)
	logKeys, _ := json.Marshal(report.LogBlobKeys)
	ssKeys, _ := json.Marshal(report.ScreenshotKeys)

	query := `
		INSERT INTO bug_reports (
			id, external_id, org_id, source_type, source_ide,
			source_plugin_version, title, description, stack_trace,
			file_path, line_number, status, severity, category,
			runtime_env, log_blob_keys, screenshot_keys,
			created_by, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9,
			$10, $11, 'open', $12, $13,
			$14, $15, $16,
			$17, $18, $18
		)
	`

	_, err := w.db.Exec(ctx, query,
		report.ID, report.ExternalID, report.OrgID, report.SourceType, report.SourceIDE,
		report.SourcePluginVersion, report.Title, report.Description, report.StackTrace,
		report.FilePath, report.LineNumber, report.SeverityHint, report.CategoryHint,
		envJSON, logKeys, ssKeys,
		report.CreatedBy, report.CreatedAt,
	)
	return err
}

// ─────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────

func main() {
	config := loadConfig()

	worker, err := NewWorker(config)
	if err != nil {
		log.Fatalf("Failed to create worker: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := worker.Start(ctx); err != nil {
		log.Fatalf("Worker error: %v", err)
	}
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		fmt.Sscanf(v, "%d", &n)
		return n
	}
	return fallback
}
