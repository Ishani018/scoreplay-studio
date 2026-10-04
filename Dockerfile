FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend-build
WORKDIR /build
COPY package.json ./
RUN npm install
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY frontend ./frontend
RUN npm run build

FROM ubuntu:24.04 AS app
ENV DEBIAN_FRONTEND=noninteractive
ARG AUDIVERIS_VERSION=5.11.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ghostscript python3 python3-venv python3-pip \
    libasound2t64 libfontconfig1 libfreetype6 libgtk-3-0 libx11-6 libxext6 libxrender1 libxtst6 \
    && curl -fsSL "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" -o /tmp/audiveris.deb \
    && apt-get install -y /tmp/audiveris.deb \
    && rm -f /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app ./backend/app
COPY --from=frontend-build /build/dist ./dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
