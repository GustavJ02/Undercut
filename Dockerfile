# Undercut game server: builds the web client, then runs the FastAPI server that serves it. Works on x86-64 and ARM64 (Raspberry Pi).
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
COPY circuits/ /app/circuits/
COPY NOTICES-server.txt /app/
RUN npm run build

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY engine/ engine/
COPY server/ server/
COPY scoring/ scoring/
COPY params/bundle.schema.json params/
COPY params/bundles/ params/bundles/
COPY circuits/ circuits/
COPY mods/examples/ mods/examples/
COPY --from=client /app/client/dist client/dist

# Race logs and extra content packs live in volumes, so the image can be replaced without losing them.
ENV UNDERCUT_LOGS=/data/logs UNDERCUT_MODS=/data/mods UNDERCUT_STATS=/data/stats.json
RUN useradd --system --create-home undercut && mkdir -p /data/logs /data/mods && chown -R undercut /data
USER undercut
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/options', timeout=4)"
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
