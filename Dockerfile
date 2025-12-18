# Backend Dockerfile for NestJS Application
# Multi-stage build for optimized production image

# Stage 1: Dependencies
FROM --platform=linux/amd64 node:20-alpine AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
# Use npm ci if lock file exists, otherwise npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Stage 2: Builder
FROM --platform=linux/amd64 node:20-alpine AS builder
WORKDIR /app

# Set dummy DATABASE_URLs for Prisma generate (doesn't actually connect)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# Stage 3: Production
FROM --platform=linux/amd64 node:20-alpine AS runner
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# Copy necessary files
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Switch to non-root user
USER nestjs

# Expose port (default NestJS port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application using dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
