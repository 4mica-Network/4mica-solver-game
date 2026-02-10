/**
 * Mock 4Mica SDK
 *
 * Drop-in replacement for @4mica/sdk that operates against a
 * Core4Mica contract deployed on Hardhat. Exports the same
 * classes, functions, enums, and types as the real SDK.
 *
 * Usage in 4mica-client.ts:
 *   const SDK = localMode
 *     ? await import('./mock-sdk/index.js')
 *     : await import('@4mica/sdk');
 *
 *   const client = await SDK.Client.new(cfg);
 */

// Core classes
export { Client, ConfigBuilder, type Config } from './client.js';
export { PaymentSigner, PaymentGuaranteeRequestClaims, buildPaymentPayload } from './payment.js';
export { UserClient } from './user-client.js';
export { RecipientClient } from './recipient-client.js';

// Types and enums
export {
  SigningScheme,
  CorePublicParameters,
  GuaranteeInfo,
  AssetBalanceInfo,
} from './types.js';

export type {
  BLSCert,
  UserInfo,
  X402SignedPayment,
  PaymentRequirementsV2,
  PaymentSignature,
  PaymentPayload,
} from './types.js';
