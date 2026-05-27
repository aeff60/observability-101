/**
 * Workshop API - Introduction to Observability
 * =============================================
 * A demo Express.js API that demonstrates:
 *   - Prometheus metrics (counters, histograms, gauges)
 *   - Structured JSON logging with Winston
 *   - Distributed tracing with OpenTelemetry → Tempo
 *   - Intentionally slow and broken endpoints
 */

// ⚠️  Must be the FIRST require — instruments Express/HTTP before they load
require('./tracing');

const express = require('express');
const client = require('prom-client');
const winston = require('winston');

// ============================================================
// Logger Setup (structured JSON logs → Loki via Promtail)
// ============================================================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// ============================================================
// Prometheus Metrics Setup
// ============================================================
const register = new client.Registry();

// Built-in Node.js metrics: CPU, memory, event loop lag
client.collectDefaultMetrics({ register, prefix: 'nodejs_' });

// Metric 1: How long each request takes (Histogram)
// A histogram records values in "buckets" — very useful for percentiles
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 3, 5, 10]
});

// Metric 2: Total requests received (Counter — only goes up)
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code']
});

// Metric 3: How many requests are being handled right now (Gauge — can go up/down)
const activeRequests = new client.Gauge({
  name: 'http_active_requests',
  help: 'Number of currently active (in-flight) HTTP requests'
});

// Metric 4: API errors by type (Counter)
const apiErrorsTotal = new client.Counter({
  name: 'api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['route', 'error_type']
});

register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);
register.registerMetric(activeRequests);
register.registerMetric(apiErrorsTotal);

// ============================================================
// Express App
// ============================================================
const app = express();
app.use(express.json());

// Middleware: runs on EVERY request — records metrics + logs
app.use((req, res, next) => {
  const startTime = Date.now();
  activeRequests.inc();

  res.on('finish', () => {
    const durationSeconds = (Date.now() - startTime) / 1000;
    const route = req.route ? req.route.path : req.path;

    // Record metrics
    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode },
      durationSeconds
    );
    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode
    });
    activeRequests.dec();

    // Structured log for every request
    logger.info({
      message: 'HTTP Request',
      method: req.method,
      path: req.path,
      route,
      status: res.statusCode,
      duration_ms: Math.round(durationSeconds * 1000),
      user_agent: req.headers['user-agent'] || 'unknown'
    });
  });

  next();
});

// ============================================================
// Mock Data
// ============================================================
const users = [
  { id: 1, name: 'Alice',   role: 'admin',     department: 'Engineering' },
  { id: 2, name: 'Bob',     role: 'user',      department: 'Marketing' },
  { id: 3, name: 'Charlie', role: 'user',      department: 'Sales' },
  { id: 4, name: 'Diana',   role: 'moderator', department: 'Support' },
  { id: 5, name: 'Eve',     role: 'user',      department: 'Design' }
];

// ============================================================
// Routes
// ============================================================

// --- /health ---
// Use: Kubernetes/Docker health probes, load balancer health checks
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// --- /users ---
// Normal endpoint — fast response, returns user list
app.get('/users', (req, res) => {
  logger.info({ message: 'Fetching user list', count: users.length });

  res.json({
    success: true,
    count: users.length,
    data: users
  });
});

// --- /slow ---
// Simulates a slow database query or external API call
// Response time: 1000ms–3000ms (random)
app.get('/slow', async (req, res) => {
  const delayMs = Math.floor(Math.random() * 2000) + 1000; // 1s to 3s

  logger.warn({
    message: 'Slow query executing',
    expected_delay_ms: delayMs,
    note: 'Simulating expensive database query'
  });

  // Simulate async work (DB query, external API, etc.)
  await new Promise(resolve => setTimeout(resolve, delayMs));

  res.json({
    success: true,
    message: 'Slow query completed',
    simulated_delay_ms: delayMs,
    tip: 'In production, use query optimization or caching!'
  });
});

// --- /error ---
// Randomly fails 70% of the time — simulates an unreliable service
app.get('/error', (req, res) => {
  const randomValue = Math.random();

  if (randomValue < 0.7) {
    // 70% chance: return an error
    const errorScenarios = [
      { code: 500, message: 'Internal Server Error - Database connection lost' },
      { code: 500, message: 'Internal Server Error - Unhandled exception' },
      { code: 503, message: 'Service Unavailable - Downstream timeout' }
    ];

    const scenario = errorScenarios[Math.floor(Math.random() * errorScenarios.length)];

    apiErrorsTotal.inc({ route: '/error', error_type: 'server_error' });

    logger.error({
      message: 'API error occurred',
      route: '/error',
      error_code: scenario.code,
      error_message: scenario.message,
      random_value: randomValue.toFixed(3)
    });

    return res.status(scenario.code).json({
      success: false,
      error: scenario.message,
      timestamp: new Date().toISOString()
    });
  }

  // 30% chance: succeed
  logger.info({
    message: 'Error endpoint succeeded',
    route: '/error',
    success_probability: '30%'
  });

  res.json({
    success: true,
    message: 'You got lucky! This endpoint fails 70% of the time.',
    tip: 'Watch the error rate in Grafana!'
  });
});

// --- /metrics ---
// Prometheus scrapes this endpoint every 5 seconds
// NEVER expose this publicly in production!
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.error({ message: 'Failed to collect metrics', error: err.message });
    res.status(500).end(err.message);
  }
});

// --- 404 Handler ---
app.use((req, res) => {
  logger.warn({ message: 'Route not found', path: req.path, method: req.method });
  res.status(404).json({
    success: false,
    error: 'Route not found',
    available_routes: ['/health', '/users', '/slow', '/error', '/metrics']
  });
});

// ============================================================
// Start Server
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info({
    message: 'Workshop API started successfully',
    port: PORT,
    endpoints: ['/health', '/users', '/slow', '/error', '/metrics'],
    note: 'Open Grafana at http://localhost:3001 to see metrics and logs'
  });
});
