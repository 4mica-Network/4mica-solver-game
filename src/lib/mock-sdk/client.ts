/**
 * Mock Client and ConfigBuilder
 *
 * Drop-in replacement for @4mica/sdk's Client and ConfigBuilder.
 * Creates viem clients connected to Hardhat and exposes the same
 * interface as the real SDK, backed by the Core4Mica contract.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { CorePublicParameters } from './types.js';
import { UserClient } from './user-client.js';
import { RecipientClient } from './recipient-client.js';
import { PaymentSigner } from './payment.js';

// =============================================================================
// Config
// =============================================================================

export interface Config {
  rpcUrl: string;
  signer: PrivateKeyAccount;
  ethereumHttpRpcUrl?: string;
  contractAddress?: string;
}

// =============================================================================
// ConfigBuilder
// =============================================================================

export class ConfigBuilder {
  private _rpcUrl: string = '';
  private _walletPrivateKey: string = '';
  private _signer?: PrivateKeyAccount;
  private _ethereumHttpRpcUrl?: string;
  private _contractAddress?: string;
  private _authEnabled: boolean = false;

  rpcUrl(value: string): ConfigBuilder {
    this._rpcUrl = value;
    return this;
  }

  walletPrivateKey(value: string): ConfigBuilder {
    this._walletPrivateKey = value;
    return this;
  }

  signer(value: PrivateKeyAccount): ConfigBuilder {
    this._signer = value;
    return this;
  }

  ethereumHttpRpcUrl(value: string): ConfigBuilder {
    this._ethereumHttpRpcUrl = value;
    return this;
  }

  contractAddress(value: string): ConfigBuilder {
    this._contractAddress = value;
    return this;
  }

  enableAuth(): ConfigBuilder {
    this._authEnabled = true;
    return this;
  }

  build(): Config {
    const signer = this._signer || privateKeyToAccount(this._walletPrivateKey as `0x${string}`);
    return {
      rpcUrl: this._rpcUrl,
      signer,
      ethereumHttpRpcUrl: this._ethereumHttpRpcUrl,
      contractAddress: this._contractAddress,
    };
  }
}

// =============================================================================
// Client
// =============================================================================

export class Client {
  readonly params: CorePublicParameters;
  readonly user: UserClient;
  readonly recipient: RecipientClient;
  readonly signer: PaymentSigner;

  private _account: PrivateKeyAccount;

  private constructor(
    params: CorePublicParameters,
    user: UserClient,
    recipient: RecipientClient,
    signer: PaymentSigner,
    account: PrivateKeyAccount
  ) {
    this.params = params;
    this.user = user;
    this.recipient = recipient;
    this.signer = signer;
    this._account = account;
  }

  /**
   * Create a new mock client.
   *
   * In the real SDK, this connects to the 4Mica RPC server.
   * In our mock, it creates viem clients pointing at Hardhat
   * and uses the deployed Core4Mica contract address from env.
   */
  static async new(cfg: Config): Promise<Client> {
    const account = cfg.signer;

    // Determine the RPC URL for Hardhat
    // The cfg.rpcUrl might point to the old mock API (localhost:3003)
    // or to Hardhat directly (localhost:8545). We always use Hardhat.
    const hardhatRpcUrl = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';

    // Get the Core4Mica contract address from environment
    const contractAddress = cfg.contractAddress || process.env.CORE_4MICA_ADDRESS;
    if (!contractAddress) {
      throw new Error(
        'CORE_4MICA_ADDRESS not set. Run deploy:local to deploy Core4Mica contract.'
      );
    }

    // Default token address (USDC) from environment
    const defaultToken = process.env.USDC_ADDRESS as Address | undefined;

    // Create viem clients for Hardhat
    const walletClient = createWalletClient({
      account,
      chain: hardhat,
      transport: http(hardhatRpcUrl),
    });

    const publicClient = createPublicClient({
      chain: hardhat,
      transport: http(hardhatRpcUrl),
    });

    // Build CorePublicParameters matching the real SDK structure
    const params = new CorePublicParameters(
      new Uint8Array(48), // Mock BLS public key (not used locally)
      contractAddress,
      hardhatRpcUrl,
      '4Mica',   // eip712Name
      '1',       // eip712Version
      31337      // Hardhat chain ID
    );

    // Create sub-clients
    const userClient = new UserClient(
      walletClient,
      publicClient,
      account,
      contractAddress as Address,
      defaultToken
    );

    const recipientClient = new RecipientClient(
      walletClient,
      publicClient,
      account,
      contractAddress as Address
    );

    const paymentSigner = new PaymentSigner(account);

    return new Client(params, userClient, recipientClient, paymentSigner, account);
  }

  /**
   * Login (SIWE authentication).
   * No-op in local mode — there's no auth server.
   */
  async login(): Promise<{ accessToken: string; refreshToken: string }> {
    return {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    };
  }

  /**
   * Close the client.
   * No-op in local mode — no persistent connections to clean up.
   */
  async aclose(): Promise<void> {
    // Nothing to clean up
  }
}
