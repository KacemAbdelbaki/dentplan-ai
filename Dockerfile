# syntax=docker/dockerfile:1

# ---------- 1. Build the web client ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY shared ./shared
RUN npm run build

# ---------- 2. Production dependencies only ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------- 3. Runtime ----------
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="DentPlan" \
      org.opencontainers.image.description="Voice-first AI dental treatment planner: dictate a plan, get staged visits, exact prices and a patient-ready PDF." \
      org.opencontainers.image.source="https://github.com/KacemAbdelbaki/dentplan-ai" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DENTPLAN_DATA_DIR=/data

WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared

# No secrets are baked into the image: pass GEMINI_API_KEY, GROQ_API_KEY and DENTPLAN_PASSWORD at run time.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3001

# Any answer below 500 means the server is up (401 when a password is set).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "server/index.ts"]
