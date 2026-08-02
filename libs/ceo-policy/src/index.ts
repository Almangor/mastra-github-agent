/**
 * @ceo/policy — the authorization layer.
 *
 * Pure by construction: the boundary checker forbids this package from importing
 * any integration or platform lib, so every decision here is reproducible from
 * its inputs and cheap to assert in the security eval suite.
 */
export * from './config.ts';
export * from './authorize.ts';
export * from './idempotency.ts';
export * from './redaction.ts';
