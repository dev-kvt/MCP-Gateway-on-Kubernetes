FROM node:20-alpine AS builder
WORKDIR /app
# better-sqlite3 requires build tools
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev
RUN apk del python3 make g++
COPY --from=builder /app/dist ./dist

# Data directory for SQLite
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "dist/index.js"]
