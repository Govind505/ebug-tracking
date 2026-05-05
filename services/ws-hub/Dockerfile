FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 8082
CMD ["node", "--loader", "ts-node/esm", "src/server.ts"]
