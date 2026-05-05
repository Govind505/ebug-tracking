# eBug Tracking

**Universal Quality Fabric — Cloud-Native, AI-Driven Bug Tracking Ecosystem**

eBug Tracking is not a ticketing system. It's an ambient quality fabric that lives inside your IDE, powered by a globally distributed cloud backbone. Bugs are detected before they're filed, deduplicated via vector similarity, and resolved without leaving your editor.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EDGE LAYER (IDE Plugins)                     │
│   VS Code Extension │ IntelliJ Plugin │ CLI Agent                  │
└────────────┬────────────────────┬───────────────┬──────────────────┘
             │ gRPC/WebSocket     │               │
┌────────────▼────────────────────▼───────────────▼──────────────────┐
│                      INGESTION MESH (K8s)                          │
│   API Gateway → gRPC Relay / WebSocket Hub → Ingestion Worker     │
└────────────────────────────┬──────────────────────────────────────┘
                             │ NATS JetStream
┌────────────────────────────▼──────────────────────────────────────┐
│                   INTELLIGENCE LAYER (K8s + Serverless)            │
│   Dedup Engine │ Severity Scorer │ Root Cause Analyzer │ Assigner │
└────────────────────────────┬──────────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────────┐
│                         DATA LAYER                                 │
│   PostgreSQL (Structured) │ Pinecone/Milvus (Vector) │ S3 (Blobs)│
└───────────────────────────────────────────────────────────────────┘
```

## Event Pipeline

```
IDE/API → bug.ingest.request → Ingestion Worker → bug.created
  → Dedup Engine → bug.classified → Severity Scorer → bug.scored
  → Root Cause Analyzer → bug.triaged → WebSocket Hub → Dashboard/IDE
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------| 
| Event Bus | NATS JetStream | Inter-service messaging (~100μs latency) |
| Structured Data | PostgreSQL 16 | Bug reports, users, teams, activity log |
| Vector Search | Milvus / Pinecone | Bug deduplication via embedding similarity |
| Object Storage | S3 / MinIO | Logs, screenshots, coredumps |
| Cache | Redis 7 | Sessions, hot data, rate limiting |
| Container Orchestration | Kubernetes | Service deployment and scaling |
| IDE Plugins | TypeScript (Core) + Editor Bridges | Universal plugin architecture |
| AI / LLM | OpenAI GPT-4o / Anthropic Claude | Root cause analysis |
| ML Model | scikit-learn (GBM + Calibration) | Severity scoring |
| Dashboard | React 19 + Vite + Recharts | Admin management interface |
| Auth | OIDC PKCE + JWT | Authentication & authorization |
| CI/CD | GitHub Actions | Build, test, deploy pipeline |

## Quick Start (Local Development)

```bash
# 1. Clone and install
git clone <repo-url> && cd ebug-tracking
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — minimum: NATS_URL, DATABASE_URL, S3_ENDPOINT

# 3. Start infrastructure
docker compose up -d

# 4. Verify infrastructure
curl http://localhost:8222/healthz   # NATS
curl http://localhost:9001           # MinIO Console

# 5. Start backend services (in separate terminals)
cd services/api-gateway && npm run dev        # REST API (port 8090)
cd services/ws-hub && npm run dev             # WebSocket Hub (port 8082)
cd services/ingestion-worker && go run .      # Ingestion (port 8080)
cd services/dedup-engine && python main.py    # Dedup Engine (port 8083)
cd services/severity-scorer && python main.py # Severity Scorer (port 8084)
cd services/root-cause-analyzer && python main.py  # RCA (port 8085)

# 6. Start dashboard
cd apps/dashboard && npm run dev              # Dashboard (port 5173)

# 7. Health check
curl http://localhost:8090/health
```

## Project Structure

```
ebug-tracking/
├── .github/workflows/        # CI/CD pipeline (GitHub Actions)
│   └── ci.yml                # Build, lint, test, Docker for all services
├── proto/                    # Protobuf service definitions
│   └── ebug/v1/
│       ├── bug_report.proto  # Core data types (BugReport, CodeLocation, etc.)
│       └── bug_service.proto # gRPC service contract (8 RPC methods)
├── packages/                 # Shared libraries (npm workspaces)
│   ├── core-proto/           # TypeScript types mirroring proto definitions
│   └── core-sync/            # IDE ↔ Cloud sync engine (offline-first)
├── services/                 # Backend microservices
│   ├── api-gateway/          # TypeScript/Express — REST API + JWT auth
│   ├── ingestion-worker/     # Go — bug ingestion, S3 upload, persistence
│   ├── dedup-engine/         # Python — vector dedup via Milvus embeddings
│   ├── severity-scorer/      # Python — hybrid ML severity classification
│   ├── root-cause-analyzer/  # Python — LLM-based root cause analysis
│   └── ws-hub/               # TypeScript — WebSocket push server + JWT auth
├── apps/                     # Frontend applications
│   └── dashboard/            # React 19 + Vite — management dashboard (9 pages)
├── plugins/                  # IDE extensions
│   └── vscode/               # VS Code extension (OIDC auth, sync, diagnostics)
├── infra/                    # Infrastructure as code
│   ├── db/init.sql           # PostgreSQL schema (5 tables + indexes)
│   └── k8s/                  # Kubernetes manifests
│       ├── namespaces.yaml   # 4 namespaces (core, ingestion, ai, data)
│       ├── deployments.yaml  # 6 deployments + 3 services
│       └── ingress.yaml      # Ingress, HPAs, NetworkPolicies
├── docker-compose.yml        # Local dev stack (PostgreSQL, NATS, Redis, Milvus, MinIO)
├── .env.example              # Environment configuration template
└── package.json              # Monorepo root
```

## Authentication

The platform uses JWT-based authentication with OIDC support:

- **API Gateway**: JWT middleware validates tokens on all `/api/v1` routes
- **WebSocket Hub**: JWT verification on connection with token claims extraction
- **VS Code Extension**: OIDC PKCE flow with SecretStorage for secure token persistence
- **Dev Mode**: Set `EBUG_DEV_MODE=true` to bypass auth with `dev-token`

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Real-time overview with stats, severity charts, and activity feed |
| **Bug Reports** | Filterable/sortable bug list with inline severity badges |
| **Bug Detail** | Full detail view with AI analysis, stack trace, linked PRs |
| **Analytics** | Severity distribution, category breakdown, status pipeline, hotspots |
| **AI Triage** | AI pipeline visualization, pending analysis queue, confidence scores |
| **Deduplication** | Duplicate cluster view with similarity scores and threshold config |
| **Teams** | Team management and member assignment |
| **Security** | Security overview and vulnerability tracking |
| **Settings** | System configuration and integration settings |

All pages automatically fetch from the live API when available and fall back to mock data for offline development.

## Kubernetes Deployment

```bash
# Apply namespace and core resources
kubectl apply -f infra/k8s/namespaces.yaml
kubectl apply -f infra/k8s/deployments.yaml
kubectl apply -f infra/k8s/ingress.yaml

# Resources include:
# - Ingress with TLS, rate limiting, host-based routing
# - HPAs for all 6 services (auto-scaling on CPU/memory)
# - Network policies restricting cross-namespace access
```

## License

Proprietary — eBug Tracking © 2026
