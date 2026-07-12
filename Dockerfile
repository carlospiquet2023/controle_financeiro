FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
LABEL org.opencontainers.image.title="Finora" \
      org.opencontainers.image.description="Central financeira familiar" \
      org.opencontainers.image.authors="Carlao Antonio de Oliveira Piquet <carlos.piquet2016@gmail.com>" \
      org.opencontainers.image.licenses="LicenseRef-Finora-Proprietary-1.0" \
      org.opencontainers.image.source="https://github.com/carlospiquet2023/controle_financeiro"
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/LICENSE /app/NOTICE.md /app/AUTHORS.md ./
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
