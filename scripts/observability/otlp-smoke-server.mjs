import http from 'node:http';

const port = Number(process.env.OTLP_SMOKE_PORT || '4318');
const host = process.env.OTLP_SMOKE_HOST || '127.0.0.1';
const exitAfterTrace = process.env.OTLP_SMOKE_EXIT_AFTER_TRACE === 'true';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('OTLP_SMOKE_PORT must be an integer from 1 to 65535.');
}

let traceRequests = 0;

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, traceRequests }));
    return;
  }

  if (request.method !== 'POST' || request.url !== '/v1/traces') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }

  let bytes = 0;
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 10 * 1024 * 1024) request.destroy();
  });
  request.on('end', () => {
    if (bytes === 0) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'EMPTY_TRACE' }));
      return;
    }

    traceRequests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
    console.log(JSON.stringify({
      event: 'otlp.trace_received',
      contentType: request.headers['content-type'] || null,
      bytes,
      traceRequests,
    }));

    if (exitAfterTrace) {
      setTimeout(() => server.close(() => process.exit(0)), 25);
    }
  });
});

server.listen(port, host, () => {
  console.log(JSON.stringify({
    event: 'otlp.smoke_collector_ready',
    endpoint: `http://${host}:${port}`,
  }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'otlp.smoke_collector_shutdown', signal, traceRequests }));
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
