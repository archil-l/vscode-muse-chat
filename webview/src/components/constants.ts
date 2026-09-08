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

export const AI_CHAT_CSS = `
.ai-chat-resize-handle { display: flex; }
.ai-chat-artifact-panel { overflow: hidden; display: flex; flex-direction: column; width: var(--artifact-panel-width); flex-shrink: 0; }
@container artifact (max-width: ${MOBILE_MAX_WIDTH}px) {
  .ai-chat-resize-handle { display: none; }
  .ai-chat-artifact-panel { display: none; width: 100%; flex-shrink: 1; }
}
/* Slash menu: show more than 4 items — use tokens, no raw values */
div[role="listbox"] { max-height: var(--spacing-80, 320px) !important; overflow-y: auto !important; }
div[role="listbox"] > div[role="group"] { max-height: none; }
/* Typography — VS Code theme aware via tokens */
body, .astryx-text, .astryx-heading { font-weight:380 !important; letter-spacing:0.01em; -webkit-font-smoothing:antialiased; }
.astryx-text--supporting { font-size: var(--font-size-supporting, var(--spacing-3)) !important; }
#muse-header, .astryx-chat-composer { font-size: var(--font-size-body-sm, 12.5px) !important; }
/* VS Code-native composer radius: 6px (Copilot-like). Astryx default is 28px pill. */
.astryx-chat-composer { --_chat-composer-radius: var(--radius-element, 6px) !important; }
.astryx-chat-composer textarea, .astryx-chat-composer [contenteditable] { border-radius: var(--radius-element, 6px) !important; }
/* Send button: match composer radius via token */
button[aria-label="Send"], button:has(svg[data-icon="paper-airplane"]) { width: var(--spacing-7, 28px) !important; height: var(--spacing-7, 28px) !important; border-radius: var(--radius-element, 6px) !important; }
/* Composer compact: remove header gap, tighten input — header removed so input starts at top */
.astryx-chat-composer { --_chat-composer-padding: var(--spacing-2, 8px) !important; }
.astryx-chat-composer [data-orientation="vertical"] { gap: var(--spacing-1, 4px) !important; }
/* Today divider — pin to top (was centered with large block margin) */
.astryx-chat-system-message, div:has(> .astryx-divider) { margin-block-start: var(--spacing-2, 8px) !important; }
.astryx-chat-system-message { padding-block: var(--spacing-1, 4px) !important; }
/* Open menus one click smaller — DropdownMenu + Typeahead + Dialog list items */
div[role="menu"], div[role="listbox"], div[role="dialog"] { font-size: var(--font-size-sm, 0.75rem) !important; }
div[role="menu"] [role="menuitem"], div[role="menu"] [role="menuitemradio"], div[role="listbox"] [role="option"] { font-size: var(--font-size-sm, 0.75rem) !important; line-height: 1.5 !important; }
.astryx-dropdown-menu, .astryx-typeahead, .astryx-list-item { font-size: var(--font-size-sm, 0.75rem) !important; }
`;

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
