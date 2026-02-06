// Re-export the compiled contract as Hello namespace
export * as Hello from './managed/hello/contract/index.js';

// Private state type (empty for this contract)
export type HelloPrivateState = {};

// Witnesses (none needed for this contract)
export const witnesses = {};
