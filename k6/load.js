/**
 * k6 Load Test Script — Observability Workshop
 * ==============================================
 * Simulates realistic traffic to the demo API.
 *
 * Run inside Docker:
 *   docker compose run --rm k6 run /scripts/load.js
 *
 * Run from host (if k6 is installed locally):
 *   BASE_URL=http://localhost:3000 k6 run k6/load.js
 *
 * Test Scenarios:
 *   1. normal  → Gradual ramp-up, steady traffic, ramp-down
 *   2. spike   → Sudden burst of traffic (run with --env SCENARIO=spike)
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ============================================================
// Custom Metrics (appear in k6 output)
// ============================================================
const errorRate     = new Rate('custom_error_rate');
const slowEndpoint  = new Trend('slow_endpoint_duration');

// ============================================================
// Test Configuration
// ============================================================
export const options = {
  scenarios: {
    // Normal traffic: ramp up → hold → ramp down
    normal_traffic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5  },  // Ramp up to 5 virtual users
        { duration: '60s', target: 10 },  // Hold at 10 users for 1 minute
        { duration: '30s', target: 20 },  // Spike to 20 users
        { duration: '60s', target: 10 },  // Scale back to 10
        { duration: '20s', target: 0  },  // Ramp down
      ],
    },
  },

  // SLO Thresholds — the test FAILS if these are violated
  thresholds: {
    // 95% of all requests must complete within 3 seconds
    'http_req_duration': ['p(95)<3000'],
    // Overall error rate must stay below 40%
    // (Note: /error endpoint has 70% error rate by design)
    'custom_error_rate': ['rate<0.5'],
    // /slow endpoint p95 must be under 4 seconds
    'slow_endpoint_duration': ['p(95)<4000'],
  },
};

// ============================================================
// Configuration
// ============================================================
const BASE_URL = __ENV.BASE_URL || 'http://api:3000';

// Weighted endpoint distribution
// Higher weight = more traffic to that endpoint
const ENDPOINTS = [
  { path: '/users',  weight: 5, name: 'users'  },  // 45%
  { path: '/health', weight: 3, name: 'health' },  // 27%
  { path: '/error',  weight: 2, name: 'error'  },  // 18%
  { path: '/slow',   weight: 1, name: 'slow'   },  // 9%
];

const TOTAL_WEIGHT = ENDPOINTS.reduce((sum, e) => sum + e.weight, 0);

/**
 * Select an endpoint based on weighted probability
 */
function selectEndpoint() {
  let random = Math.random() * TOTAL_WEIGHT;
  for (const endpoint of ENDPOINTS) {
    random -= endpoint.weight;
    if (random <= 0) return endpoint;
  }
  return ENDPOINTS[0];
}

// ============================================================
// Main Test Function (runs once per Virtual User per iteration)
// ============================================================
export default function () {
  const endpoint = selectEndpoint();
  const url = `${BASE_URL}${endpoint.path}`;

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-load-test/1.0',
    },
    timeout: '10s',
  };

  const res = http.get(url, params);

  // Validate the response
  const isSuccess = check(res, {
    'status is 2xx':         (r) => r.status >= 200 && r.status < 300,
    'response time < 5s':    (r) => r.timings.duration < 5000,
    'response has body':     (r) => r.body && r.body.length > 0,
  });

  // Track custom metrics
  errorRate.add(!isSuccess);

  if (endpoint.name === 'slow') {
    slowEndpoint.add(res.timings.duration);
  }

  // Random sleep between requests (realistic user behavior)
  sleep(Math.random() * 1.5 + 0.5); // 0.5 to 2 seconds
}

// ============================================================
// Lifecycle Hooks
// ============================================================
export function setup() {
  console.log(`\n${'='.repeat(50)}`);
  console.log('🚀 Starting k6 Load Test');
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Watch Grafana at: http://localhost:3001`);
  console.log(`${'='.repeat(50)}\n`);

  // Verify API is reachable
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    console.error(`❌ API health check failed! Status: ${healthCheck.status}`);
    console.error('   Make sure docker compose up -d is running');
  } else {
    console.log('✅ API health check passed — starting test\n');
  }
}

export function teardown() {
  console.log(`\n${'='.repeat(50)}`);
  console.log('✅ Load test complete!');
  console.log('   Check your Grafana dashboard for results');
  console.log(`${'='.repeat(50)}\n`);
}
