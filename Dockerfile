# syntax=docker/dockerfile:1

# ---- build: compile the web client and bundle the server ----
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: server bundle, its production deps, migrations, and the static web build ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @st/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/server/drizzle apps/server/drizzle
COPY --from=build /src/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
# "app" runs the web server + API; "worker" runs the daily reset and background jobs.
ENTRYPOINT ["node", "apps/server/dist/main.js"]
CMD ["app"]
