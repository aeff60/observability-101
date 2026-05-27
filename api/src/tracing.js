'use strict';

/**
 * OpenTelemetry Tracing Setup
 * ===========================
 * This file MUST be required before any other module.
 * It instruments Express, HTTP, and other modules automatically.
 *
 * Config is read from environment variables (set in docker-compose):
 *   OTEL_SERVICE_NAME             → service name shown in Tempo
 *   OTEL_EXPORTER_OTLP_ENDPOINT   → OTel Collector gRPC address
 *   OTEL_TRACES_EXPORTER          → "otlp"
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  // Exporter: sends spans to OTel Collector via gRPC
  // URL comes from OTEL_EXPORTER_OTLP_ENDPOINT env var
  traceExporter: new OTLPTraceExporter(),

  // Auto-instrument: Express, HTTP, DNS, etc.
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable fs instrumentation — too noisy for a workshop
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Graceful shutdown — flush pending spans before exiting
process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
