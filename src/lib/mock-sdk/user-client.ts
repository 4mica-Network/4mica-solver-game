/**
 * Mock UserClient
 *
 * Implements the same interface as @4mica/sdk's UserClient.
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
import { MockERC20ABI, Core4MicaABI } from '../abis.js';
import type { UserInfo } from './types.js';

export class UserClient {
  private walletClient: WalletClient;
  private publicClient: PublicClient;
  private account: Account;
  private contractAddress: Address;
  private defaultToken?: Address;

  constructor(
    walletClient: WalletClient,
    publicClient: PublicClient,
    account: Account,
    contractAddress: Address,
    defaultToken?: Address
  ) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
    this.account = account;
    this.contractAddress = contractAddress;
    this.defaultToken = defaultToken;
  }

  /**
   * Approve the Core4Mica contract to spend ERC20 tokens.
   */
  async approveErc20(
    token: string,
    amount: number | bigint | string
  ): Promise<TransactionReceipt> {
    const hash = await this.walletClient.writeContract({
      address: token as Address,
      abi: MockERC20ABI,
      functionName: 'approve',
      args: [this.contractAddress, BigInt(amount)],
      account: this.account,
      chain: this.walletClient.chain,
    });

    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Deposit collateral into the Core4Mica contract.
   * Automatically approves the contract first.
   */
  async deposit(
    amount: number | bigint | string,
    erc20Token?: string
  ): Promise<TransactionReceipt> {
    const token = (erc20Token || this.defaultToken) as Address;
    const amountBn = BigInt(amount);

    // First approve the contract to pull tokens
    await this.approveErc20(token, amountBn);

    // Then deposit
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'deposit',
      args: [token, amountBn],
      account: this.account,
      chain: this.walletClient.chain,
    });

    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Get user collateral information from the contract.
   * Returns an array of UserInfo (one per asset).
   */
  async getUser(): Promise<UserInfo[]> {
    if (!this.defaultToken) return [];

    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'getUserCollateral',
      args: [this.account.address as Address, this.defaultToken],
    }) as [bigint, bigint, bigint, bigint, bigint];

    const [total, _locked, _available, withdrawalRequestAmount, withdrawalRequestTimestamp] = result;

    return [{
      asset: this.defaultToken,
      collateral: total,
      withdrawalRequestAmount,
      withdrawalRequestTimestamp: Number(withdrawalRequestTimestamp),
    }];
  }

  /**
   * Pay a tab on-chain (happy path).
   * Calls Core4Mica.payTabInERC20Token() which transfers tokens
   * from the trader to the recipient and releases locked collateral.
   */
  async payTab(
    tabId: number | bigint,
    reqId: number | bigint,
    amount: number | bigint | string,
    recipientAddress: string,
    erc20Token?: string
  ): Promise<TransactionReceipt> {
    const token = (erc20Token || this.defaultToken) as Address;
    const amountBn = BigInt(amount);

    // Approve the Core4Mica contract to pull tokens from trader for payment
    await this.approveErc20(token, amountBn);

    // Call payTabInERC20Token on the contract
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'payTabInERC20Token',
      args: [
        BigInt(tabId),
        BigInt(reqId),
        amountBn,
        recipientAddress as Address,
        token,
      ],
      account: this.account,
      chain: this.walletClient.chain,
    });

    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Request withdrawal of collateral (starts timelock).
   */
  async requestWithdrawal(
    amount: number | bigint | string,
    erc20Token?: string
  ): Promise<TransactionReceipt> {
    const token = (erc20Token || this.defaultToken) as Address;
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'requestWithdrawal',
      args: [token, BigInt(amount)],
      account: this.account,
      chain: this.walletClient.chain,
    });
    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Cancel a pending withdrawal request.
   */
  async cancelWithdrawal(erc20Token?: string): Promise<TransactionReceipt> {
    const token = (erc20Token || this.defaultToken) as Address;
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'cancelWithdrawal',
      args: [token],
      account: this.account,
      chain: this.walletClient.chain,
    });
    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Finalize a withdrawal after the timelock has expired.
   */
  async finalizeWithdrawal(erc20Token?: string): Promise<TransactionReceipt> {
    const token = (erc20Token || this.defaultToken) as Address;
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: Core4MicaABI,
      functionName: 'finalizeWithdrawal',
      args: [token],
      account: this.account,
      chain: this.walletClient.chain,
    });
    return this.publicClient.waitForTransactionReceipt({ hash });
  }
}
