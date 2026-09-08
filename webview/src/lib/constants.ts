'use client';

import type { CSSProperties } from 'react';

export const MOBILE_MAX_WIDTH = 767;

export const root: CSSProperties = {
  height: '100vh',
  width: '100%',
  containerType: 'inline-size',
  containerName: 'artifact',
};

export const chatColumn: CSSProperties = {
  flex: 1,
  width: '100%',
  minWidth: 0,
  height: '100%',
};

export const chatLayoutStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
};

export const artifactScroll: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
};

export const articleBody: CSSProperties = {
  maxWidth: 720,
  marginInline: 'auto',
};

export const artifactPanelWidthVar = (size: number | string): CSSProperties =>
  ({ '--artifact-panel-width': typeof size === 'number' ? `${size}px` : size } as CSSProperties);

export const ARTIFACT_TITLE = 'JWT Token Refresh: Design & Rollout';
export const ARTIFACT_SUBTITLE = 'Document · Updated just now';
export const ARTIFACT_CONTENT = `## Overview

Our API gateway authenticates every request with a short-lived JWT access token. Until now, an expired token meant an immediate \`401\` — even when the user still held a valid refresh token. This document describes the silent-refresh flow we just shipped and how we're rolling it out.

## The Problem

Token validation ran **before** any refresh logic, so the middleware rejected expired tokens outright:

1. A request arrives with an expired access token
2. \`validateToken()\` throws \`TokenExpiredError\`
3. The catch block returns \`401\` — \`refreshToken()\` is never reached

## The Fix

The middleware now catches \`TokenExpiredError\` specifically and attempts a silent refresh before rejecting. On success it reissues an access token and continues the request; on failure it falls back to \`401\`.

- **Transparent** — valid sessions never see an interruption
- **Safe** — a missing or invalid refresh token still returns \`401\`
- **Cheap** — refresh only runs on the expiry path, not on every request

## Testing

| Scenario | Expected |
|----------|----------|
| Valid token passes through | \`200\` |
| Expired token, valid refresh | \`200\` + new access token |
| Expired token, invalid refresh | \`401\` |
| Malformed token | \`401\` |

## Rollout & Monitoring

1. Ship behind the \`silent_refresh\` flag at 5% of traffic
2. Watch the \`auth.refresh.success\` and \`auth.refresh.failure\` counters
3. Alert if the failure rate exceeds **2%** over any 5-minute window
4. Ramp to 100% once metrics hold steady for 24 hours`;
