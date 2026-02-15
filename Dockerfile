FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node server.js app.js index.html styles.css ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173

USER node

EXPOSE 5173

# WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD are provided at runtime.
CMD ["node", "server.js"]
