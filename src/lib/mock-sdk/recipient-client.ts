/**
 * Mock RecipientClient
 *
 * Implements the same interface as @4mica/sdk's RecipientClient.
 * All operations are executed on-chain via viem against the
 * Core4Mica contract deployed on Hardhat.
 */

import type {
  WalletClient,
  PublicClient,
  TransactionReceipt,
  Address,
  Account,
} from 'viem';
import { Core4MicaABI } from '../abis.js';
import {
  type BLSCert,
  type SigningScheme,
  GuaranteeInfo,
  AssetBalanceInfo,
} from './types.js';
import type { PaymentGuaranteeRequestClaims } from './payment.js';
import { randomBytes } from 'crypto';

export class RecipientClient {
  private walletClient: WalletClient;
  private publicClient: PublicClient;
  private account: Account;
  private contractAddress: Address;

  constructor(
    walletClient: WalletClient,
    publicClient: PublicClient,
    account: Account,
    contractAddress: Address
  ) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
    this.account = account;
    this.contractAddress = contractAddress;
  }

  private get recipientAddress(): string {
    return this.account.address;
  }

  /**
   * Create a payment tab on-chain.
   * Returns the tabId assigned by the contract.
   */
  async createTab(
    userAddress: string,
    recipientAddress: string,
    erc20Token: string | undefined | null,
    ttl?: number | null
  ): Promise<bigint> {
    const token = (erc20Token || '0x') as Address;
    const ttlSeconds = ttl || 300;

    // Read nextTabId before creating to know the assigned ID
    const nextTabId = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'nextTabId',
    }) as bigint;

    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'createTab',
      args: [
        userAddress as Address,
        recipientAddress as Address,
        token,
        BigInt(ttlSeconds),
      ],
      account: this.account,
      chain: this.walletClient.chain,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    return nextTabId;
  }

  /**
   * Issue a payment guarantee on-chain.
   *
   * Calls Core4Mica.issueGuarantee() to lock collateral, then returns
   * a mock BLSCert with JSON-encoded claims that can be decoded by
   * remunerate() later.
   */
  async issuePaymentGuarantee(
    claims: PaymentGuaranteeRequestClaims,
    signature: string,
    _scheme: SigningScheme
  ): Promise<BLSCert> {
    // Call the on-chain issueGuarantee to lock collateral
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'issueGuarantee',
      args: [
        claims.tabId,
        claims.reqId,
        claims.amount,
        signature as `0x${string}`,
      ],
      account: this.account,
      chain: this.walletClient.chain,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    // Return a mock BLS certificate with claims encoded as JSON
    // The remunerate() function will parse this to extract tabId/reqId
    const certClaims = JSON.stringify({
      tabId: claims.tabId.toString(),
      reqId: claims.reqId.toString(),
      amount: claims.amount.toString(),
      userAddress: claims.userAddress,
      recipientAddress: claims.recipientAddress,
      assetAddress: claims.assetAddress,
      timestamp: claims.timestamp,
    });

    return {
      claims: certClaims,
      signature: '0x' + randomBytes(64).toString('hex'),
    };
  }

  /**
   * Get the latest guarantee for a tab.
   * Reads the latestReqId from the contract, then fetches the guarantee.
   */
  async getLatestGuarantee(tabId: number | bigint): Promise<GuaranteeInfo | null> {
    const tabIdBn = BigInt(tabId);

    // Read latest reqId for this tab
    const latestReqId = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'getLatestReqId',
      args: [tabIdBn],
    }) as bigint;

    // If no guarantees exist, latestReqId will be 0 and the guarantee won't exist
    const guarantee = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'getGuarantee',
      args: [tabIdBn, latestReqId],
    }) as {
      tabId: bigint;
      reqId: bigint;
      user: string;
      recipient: string;
      asset: string;
      amount: bigint;
      timestamp: bigint;
      signature: string;
      claimed: boolean;
    };

    // No guarantee found (amount is 0)
    if (guarantee.amount === 0n) return null;

    return new GuaranteeInfo(
      guarantee.tabId,
      guarantee.reqId,
      guarantee.user,
      guarantee.recipient,
      guarantee.asset,
      guarantee.amount,
      Number(guarantee.timestamp)
    );
  }

  /**
   * Get user's asset balance (collateral info).
   */
  async getUserAssetBalance(
    userAddress: string,
    assetAddress: string
  ): Promise<AssetBalanceInfo | null> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'getUserCollateral',
      args: [userAddress as Address, assetAddress as Address],
    }) as [bigint, bigint, bigint, bigint, bigint];

    const [total, locked] = result;

    // If no collateral, return null
    if (total === 0n && locked === 0n) return null;

    return new AssetBalanceInfo(
      userAddress,
      assetAddress,
      total,
      locked,
      1,
      Math.floor(Date.now() / 1000)
    );
  }

  /**
   * Remunerate (unhappy path): Solver seizes locked collateral.
   *
   * Decodes the BLS certificate's claims JSON to extract tabId/reqId,
   * then calls Core4Mica.remunerate() on-chain.
   */
  async remunerate(cert: BLSCert): Promise<TransactionReceipt> {
    // Parse the claims JSON from the mock BLS certificate
    let tabId: bigint;
    let reqId: bigint;

    try {
      const parsedClaims = JSON.parse(cert.claims);
      tabId = BigInt(parsedClaims.tabId);
      reqId = BigInt(parsedClaims.reqId);
    } catch {
      // If claims isn't valid JSON, try to find tabId/reqId from the string
      throw new Error(`Cannot parse BLS certificate claims: ${cert.claims.slice(0, 50)}...`);
    }

    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'remunerate',
      args: [tabId, reqId],
      account: this.account,
      chain: this.walletClient.chain,
    });

    return this.publicClient.waitForTransactionReceipt({ hash });
  }
}
