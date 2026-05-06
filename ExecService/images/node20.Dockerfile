FROM node:20-alpine
RUN npm install -g tsx
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace && chmod 755 /workspace
WORKDIR /workspace
USER sandbox
