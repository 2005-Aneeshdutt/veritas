# One image, one service: the console is built to static files and served by
# the FastAPI app from the same origin (see the end of src/doctor/api.py).

# --- stage 1: build the console ---------------------------------------------
FROM node:22-slim AS console
WORKDIR /app/console
COPY console/package.json console/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY console/ ./
# "/" = same origin. The client calls /api/... on whatever host served it.
ENV VITE_API_BASE_URL=/
RUN npm run build

# --- stage 2: the API, carrying the built console ---------------------------
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONPATH=src \
    PYTHONUNBUFFERED=1 \
    DOCTOR_SEED=20260824
COPY . .
RUN pip install --no-cache-dir -e .
COPY --from=console /app/console/.output/public ./console/.output/public
EXPOSE 8000
CMD ["sh", "-c", "uvicorn doctor.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
