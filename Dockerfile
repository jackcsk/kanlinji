FROM node:24-alpine AS test
WORKDIR /app
COPY package.json server.js LICENSE LICENSE-MIT ./
COPY public ./public
COPY data ./data
COPY test ./test
RUN npm test && npm run check

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=test --chown=node:node /app/package.json /app/server.js /app/LICENSE /app/LICENSE-MIT ./
COPY --from=test --chown=node:node /app/public ./public
COPY --from=test --chown=node:node /app/data ./data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
