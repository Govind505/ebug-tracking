FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /ingestion-worker .

FROM alpine:3.20
RUN apk --no-cache add ca-certificates
COPY --from=builder /ingestion-worker /ingestion-worker

USER 1001
EXPOSE 8080
ENTRYPOINT ["/ingestion-worker"]
