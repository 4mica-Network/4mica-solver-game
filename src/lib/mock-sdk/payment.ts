/**
 * Mock Payment Signer, Claims, and Payload Builder
 *
 * Mirrors @4mica/sdk's PaymentSigner, PaymentGuaranteeRequestClaims,
 * and buildPaymentPayload. Uses real EIP-712 signing via viem for
 * faithful reproduction of the Sepolia flow.
 */

import type { Account } from 'viem';
import {
  SigningScheme,
  CorePublicParameters,
  type PaymentSignature,
  type PaymentPayload,
} from './types.js';

// =============================================================================
// PaymentGuaranteeRequestClaims
// =============================================================================

export class PaymentGuaranteeRequestClaims {
  userAddress: string;
  recipientAddress: string;
  tabId: bigint;
  reqId: bigint;
  amount: bigint;
  timestamp: number;
  assetAddress: string;

  constructor(init: {
    userAddress: string;
    recipientAddress: string;
    tabId: bigint;
    reqId?: bigint;
    amount: bigint;
    timestamp: number;
    assetAddress: string;
  }) {
    this.userAddress = init.userAddress;
    this.recipientAddress = init.recipientAddress;
    this.tabId = init.tabId;
    this.reqId = init.reqId ?? 0n;
    this.amount = init.amount;
    this.timestamp = init.timestamp;
    this.assetAddress = init.assetAddress;
  }

  static new(
    userAddress: string,
    recipientAddress: string,
    tabId: number | bigint | string,
    amount: number | bigint | string,
    timestamp: number,
    erc20Token?: string | null,
    reqId?: number | bigint | string
  ): PaymentGuaranteeRequestClaims {
    return new PaymentGuaranteeRequestClaims({
      userAddress,
      recipientAddress,
      tabId: BigInt(tabId),
      reqId: reqId !== undefined ? BigInt(reqId) : 0n,
      amount: BigInt(amount),
      timestamp,
      assetAddress: erc20Token || '0x',
    });
  }
}

// =============================================================================
// PaymentSigner
// =============================================================================

export class PaymentSigner {
  readonly signer: Account;

  constructor(signer: Account) {
    this.signer = signer;
  }

  /**
   * Sign payment claims using EIP-712 typed data.
   * In local mode, we produce a real EIP-712 signature using viem,
   * though the on-chain contract doesn't verify it. This keeps the
   * TypeScript flow identical to Sepolia.
   */
  async signRequest(
    params: CorePublicParameters,
    claims: PaymentGuaranteeRequestClaims,
    scheme: SigningScheme = SigningScheme.EIP712
  ): Promise<PaymentSignature> {
    // Build EIP-712 typed data matching the 4Mica domain
    const domain = {
      name: params.eip712Name,
      version: params.eip712Version,
      chainId: params.chainId,
      verifyingContract: params.contractAddress as `0x${string}`,
    };

    const types = {
      PaymentGuaranteeRequest: [
        { name: 'userAddress', type: 'address' },
        { name: 'recipientAddress', type: 'address' },
        { name: 'tabId', type: 'uint256' },
        { name: 'reqId', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'assetAddress', type: 'address' },
      ],
    };

    const message = {
      userAddress: claims.userAddress as `0x${string}`,
      recipientAddress: claims.recipientAddress as `0x${string}`,
      tabId: claims.tabId,
      reqId: claims.reqId,
      amount: claims.amount,
      timestamp: BigInt(claims.timestamp),
      assetAddress: claims.assetAddress as `0x${string}`,
    };

    // Use the account's signTypedData if available (local accounts have it)
    let signature: string;
    if (this.signer.signTypedData) {
      signature = await this.signer.signTypedData({
        domain,
        types,
        primaryType: 'PaymentGuaranteeRequest',
        message,
      });
    } else {
      // Fallback: produce a deterministic mock signature
      signature = '0x' + 'ab'.repeat(65);
    }

    return {
      signature,
      scheme,
    };
  }
}

// =============================================================================
// buildPaymentPayload
// =============================================================================

export function buildPaymentPayload(
  claims: PaymentGuaranteeRequestClaims,
  signature: PaymentSignature | string,
  scheme?: SigningScheme
): PaymentPayload {
  const sig = typeof signature === 'string' ? signature : signature.signature;
  const sigScheme = typeof signature === 'string'
    ? (scheme || SigningScheme.EIP712)
    : signature.scheme;

  return {
    claims: {
      version: '1',
      user_address: claims.userAddress,
      recipient_address: claims.recipientAddress,
      tab_id: claims.tabId.toString(),
      req_id: claims.reqId.toString(),
      amount: claims.amount.toString(),
      timestamp: claims.timestamp,
      asset_address: claims.assetAddress,
    },
    signature: sig,
    scheme: sigScheme,
  };
}
