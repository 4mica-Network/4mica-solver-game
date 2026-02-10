/**
 * Mock SDK Type Definitions
 *
 * Compatible interfaces matching @4mica/sdk types.
 * Only the types actually used by 4mica-client.ts and settlement-mgr.ts
 * are defined here.
 */

// =============================================================================
// Core Types
// =============================================================================

export interface BLSCert {
  claims: string;
  signature: string;
}

export interface UserInfo {
  asset: string;
  collateral: bigint;
  withdrawalRequestAmount: bigint;
  withdrawalRequestTimestamp: number;
}

export interface PaymentSignature {
  signature: string;
  scheme: SigningScheme;
}

export enum SigningScheme {
  EIP712 = 'eip712',
  EIP191 = 'eip191',
}

// =============================================================================
// Payment Types
// =============================================================================

export interface PaymentPayloadClaims {
  version: string;
  user_address: string;
  recipient_address: string;
  tab_id: string;
  req_id: string;
  amount: string;
  timestamp: number;
  asset_address: string;
}

export interface PaymentPayload {
  claims: PaymentPayloadClaims;
  signature: string;
  scheme: SigningScheme;
}

export type X402PaymentPayload = PaymentPayload;

export interface X402SignedPayment {
  header: string;
  payload: PaymentPayload;
  signature: PaymentSignature;
}

export interface PaymentRequirementsV2 {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

// =============================================================================
// Core Public Parameters
// =============================================================================

export class CorePublicParameters {
  publicKey: Uint8Array;
  contractAddress: string;
  ethereumHttpRpcUrl: string;
  eip712Name: string;
  eip712Version: string;
  chainId: number;

  constructor(
    publicKey: Uint8Array,
    contractAddress: string,
    ethereumHttpRpcUrl: string,
    eip712Name: string,
    eip712Version: string,
    chainId: number
  ) {
    this.publicKey = publicKey;
    this.contractAddress = contractAddress;
    this.ethereumHttpRpcUrl = ethereumHttpRpcUrl;
    this.eip712Name = eip712Name;
    this.eip712Version = eip712Version;
    this.chainId = chainId;
  }
}

// =============================================================================
// Guarantee Info (returned by getLatestGuarantee)
// =============================================================================

export class GuaranteeInfo {
  tabId: bigint;
  reqId: bigint;
  fromAddress: string;
  toAddress: string;
  assetAddress: string;
  amount: bigint;
  timestamp: number;
  certificate?: string | null;

  constructor(
    tabId: bigint,
    reqId: bigint,
    fromAddress: string,
    toAddress: string,
    assetAddress: string,
    amount: bigint,
    timestamp: number,
    certificate?: string | null
  ) {
    this.tabId = tabId;
    this.reqId = reqId;
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.assetAddress = assetAddress;
    this.amount = amount;
    this.timestamp = timestamp;
    this.certificate = certificate;
  }
}

// =============================================================================
// Asset Balance Info (returned by getUserAssetBalance)
// =============================================================================

export class AssetBalanceInfo {
  userAddress: string;
  assetAddress: string;
  total: bigint;
  locked: bigint;
  version: number;
  updatedAt: number;

  constructor(
    userAddress: string,
    assetAddress: string,
    total: bigint,
    locked: bigint,
    version: number,
    updatedAt: number
  ) {
    this.userAddress = userAddress;
    this.assetAddress = assetAddress;
    this.total = total;
    this.locked = locked;
    this.version = version;
    this.updatedAt = updatedAt;
  }
}
