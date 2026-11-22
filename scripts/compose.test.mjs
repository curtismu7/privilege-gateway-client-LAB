import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docker-compose.yml publishes only on 127.0.0.1', () => {
  const ports = publishedPorts(here('docker-compose.yml'));
  assert.ok(ports.length > 0, 'the parser found the published port');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7833:7833"', '- "0.0.0.0:7833:7833"', '- 7833', '- "::1:7833:7833"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose, Dockerfile and the server agree on the one port, 7833', () => {
  const compose = here('docker-compose.yml');
  assert.equal(Number(/\$\{HOST_PORT:-(\d+)\}/.exec(compose)[1]), 7833);
  assert.match(compose, /:7833"/);
  assert.match(compose, /PORT: "7833"/);
  assert.match(compose, /127\.0\.0\.1:7833\/api\/health/);
  const docker = here('Dockerfile');
  assert.equal(Number(/^EXPOSE (\d+)/m.exec(docker)[1]), 7833);
  assert.match(docker, /PORT=7833/);
});

test('the image is Node 26, runs as node, and listens on all interfaces only inside the container', () => {
  const docker = here('Dockerfile');
  assert.match(docker, /^FROM node:26[\w.-]* AS build$/m);
  assert.match(docker, /^FROM node:26[\w.-]*$/m);
  assert.doesNotMatch(docker, /FROM node:(?!26)/);
  assert.match(docker, /^USER node$/m);
  assert.match(docker, /^ENV PGC_BIND=0\.0\.0\.0$/m);
  assert.match(docker, /^ENV .*\bMODE=mock\b/m, 'the image default stays mock (rule 19)');
});

test('the container is locked down: read-only fs, no capabilities, no new privileges, restart policy (rule 21), healthcheck', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /demo-health\/1/);
});

test('settings come from the lab own ./.env, optional, and no absolute author path appears (portable)', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /env_file:\s*\n\s*- path: \.\/\.env\s*\n\s*required: false/);
  for (const f of ['docker-compose.yml', 'Dockerfile', '.dockerignore']) {
    const t = here(f);
    assert.doesNotMatch(t, /\/Users\//, `${f}: no absolute home path`);
    assert.doesNotMatch(t, /\/Development\/\.env|~\/Documents|STANDALONE_ENV/, `${f}: no shared settings file`);
  }
});

test('LAB_ALLOWED_HOSTS and SHELF_URL pass through with safe defaults; MODE follows PGC_MODE, empty when unset', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /LAB_ALLOWED_HOSTS: \$\{LAB_ALLOWED_HOSTS:-privilege-gateway-client\.local\.ping-devops\.com\}/);
  assert.match(compose, /SHELF_URL: \$\{SHELF_URL:-https:\/\/local\.ping-devops\.com:8443\/demo-shelf\}/);
  assert.match(compose, /^      MODE: \$\{PGC_MODE:-\}$/m);
});

test('the Dockerfile copies the diagram data before the web build reads it, and .dockerignore does not drop it (rule 17)', () => {
  const docker = here('Dockerfile');
  const copy = docker.indexOf('COPY diagrams diagrams');
  assert.ok(copy > 0, 'COPY diagrams diagrams is missing');
  assert.ok(copy > docker.indexOf('COPY web web') && copy < docker.indexOf('RUN npm run build -w web'), 'it must sit between COPY web and the web build');
  const ignored = here('.dockerignore').split('\n').map((l) => l.trim());
  assert.ok(!ignored.some((l) => /^\/?diagrams\/?(\*.*)?$/.test(l)), '.dockerignore must not list diagrams');
  assert.ok(fs.existsSync(new URL('../diagrams/pgc-call-path.json', import.meta.url)));
});
