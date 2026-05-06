FROM node:20-alpine
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox
WORKDIR /workspace
RUN chown sandbox:sandbox /workspace
USER sandbox
