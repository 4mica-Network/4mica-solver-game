/**
 * Agent0 SDK Client Wrapper for 4Mica × Agent0 Competitive Solver Game
 *
 * This module provides a typed wrapper around the Agent0 SDK for:
 * - Agent identity registration (ERC-8004)
 * - Agent discovery and search
 * - Reputation management and feedback
 *
 * Agent0 uses ERC-8004 NFT-based identities stored on-chain with metadata
 * on IPFS via Pinata.
 */

import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Agent0 Identity Metadata following ERC-8004 standard
 */
export interface AgentIdentityMetadata {
  name: string;
  description: string;
  image: string; // IPFS URI (ipfs://...)
  skills: string[];
  domains: string[];
  trust: {
    reputation: boolean;
    cryptoEconomic: boolean;
  };
  attributes?: Record<string, unknown>;
}

/**
 * Registered agent identity
 */
export interface RegisteredAgent {
  agentId: string;
  address: Address;
  metadata: AgentIdentityMetadata;
  registeredAt: number;
  tokenId?: bigint;
}

/**
 * Agent search filters
 */
export interface AgentSearchFilters {
  skills?: string[];
  domains?: string[];
  minReputation?: number;
  isActive?: boolean;
}

/**
 * Agent reputation summary
 */
export interface ReputationSummary {
  agentId: string;
  address: Address;
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  averageScore: number;
  recentFeedback: FeedbackEntry[];
}

/**
 * Feedback entry
 */
export interface FeedbackEntry {
  from: Address;
  to: Address;
  score: number; // -1 (negative), 0 (neutral), 1 (positive)
  comment?: string;
  context?: string;
  timestamp: number;
  txHash?: string;
}

/**
 * Agent0 client configuration
 */
export interface Agent0ClientConfig {
  rpcUrl: string;
  pinataJwt: string;
  privateKey?: `0x${string}`;
  registryAddress?: Address;
  reputationAddress?: Address;
}

// =============================================================================
// Agent0 ERC-8004 Registry ABI (simplified)
// =============================================================================

const AGENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      { name: 'metadataURI', type: 'string' }
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'metadataURI', type: 'string' },
      { name: 'registeredAt', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getAgentByAddress',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'metadataURI', type: 'string' },
      { name: 'registeredAt', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'isRegistered',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'metadataURI', type: 'string', indexed: false }
    ]
  }
] as const;

// =============================================================================
// Agent0 Reputation Registry ABI (simplified)
// =============================================================================

const REPUTATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'score', type: 'int8' },
      { name: 'comment', type: 'string' },
      { name: 'context', type: 'string' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'getReputationScore',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'positiveCount', type: 'uint256' },
      { name: 'negativeCount', type: 'uint256' },
      { name: 'neutralCount', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'FeedbackGiven',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'score', type: 'int8', indexed: false },
      { name: 'comment', type: 'string', indexed: false }
    ]
  }
] as const;

// =============================================================================
// Pinata IPFS Upload
// =============================================================================

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

async function uploadToIPFS(data: unknown, pinataJwt: string): Promise<string> {
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${pinataJwt}`
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: {
        name: 'agent0-metadata'
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to upload to IPFS: ${response.statusText}`);
  }

  const result = await response.json() as PinataResponse;
  return `ipfs://${result.IpfsHash}`;
}

async function fetchFromIPFS(ipfsUri: string): Promise<unknown> {
  // Convert ipfs:// URI to gateway URL
  const hash = ipfsUri.replace('ipfs://', '');
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${hash}`;

  const response = await fetch(gatewayUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
  }

  return response.json();
}

// =============================================================================
// Agent0 Client Class
// =============================================================================

export class Agent0Client {
  private config: Agent0ClientConfig;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient?: ReturnType<typeof createWalletClient>;
  private account?: ReturnType<typeof privateKeyToAccount>;

  // Default contract addresses (Sepolia)
  private static readonly DEFAULT_REGISTRY = '0x0000000000000000000000000000000000000000' as Address;
  private static readonly DEFAULT_REPUTATION = '0x0000000000000000000000000000000000000000' as Address;

  constructor(config: Agent0ClientConfig) {
    this.config = config;

    // Create public client for read operations
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(config.rpcUrl)
    });

    // Create wallet client if private key provided
    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: sepolia,
        transport: http(config.rpcUrl)
      });
    }
  }

  // ===========================================================================
  // Agent Registration
  // ===========================================================================

  /**
   * Register a new agent identity with ERC-8004
   */
  async registerAgent(metadata: AgentIdentityMetadata): Promise<RegisteredAgent> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet client not initialized. Provide privateKey in config.');
    }

    // Upload metadata to IPFS
    console.log('  Uploading metadata to IPFS...');
    const metadataUri = await uploadToIPFS(metadata, this.config.pinataJwt);
    console.log(`  Metadata URI: ${metadataUri}`);

    // Register on-chain
    const registryAddress = this.config.registryAddress || Agent0Client.DEFAULT_REGISTRY;

    if (registryAddress === Agent0Client.DEFAULT_REGISTRY) {
      // If no registry deployed, simulate registration
      console.log('  [Simulated] No registry contract deployed. Returning mock registration.');
      return {
        agentId: `agent-${this.account.address.slice(0, 10)}`,
        address: this.account.address,
        metadata,
        registeredAt: Date.now()
      };
    }

    console.log('  Registering agent on-chain...');
    const hash = await this.walletClient.writeContract({
      chain: sepolia,
      account: this.account,
      address: registryAddress,
      abi: AGENT_REGISTRY_ABI,
      functionName: 'registerAgent',
      args: [metadataUri]
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // Extract tokenId from events
    const tokenId = BigInt(1); // TODO: Parse from receipt logs

    return {
      agentId: `agent-${tokenId}`,
      address: this.account.address,
      metadata,
      registeredAt: Date.now(),
      tokenId
    };
  }

  /**
   * Check if an address is registered as an agent
   */
  async isRegistered(address: Address): Promise<boolean> {
    const registryAddress = this.config.registryAddress || Agent0Client.DEFAULT_REGISTRY;

    if (registryAddress === Agent0Client.DEFAULT_REGISTRY) {
      return false; // No registry deployed
    }

    const result = await this.publicClient.readContract({
      address: registryAddress,
      abi: AGENT_REGISTRY_ABI,
      functionName: 'isRegistered',
      args: [address]
    });

    return result as boolean;
  }

  /**
   * Get agent details by address
   */
  async getAgentByAddress(address: Address): Promise<RegisteredAgent | null> {
    const registryAddress = this.config.registryAddress || Agent0Client.DEFAULT_REGISTRY;

    if (registryAddress === Agent0Client.DEFAULT_REGISTRY) {
      return null; // No registry deployed
    }

    try {
      const [tokenId, metadataUri, registeredAt] = await this.publicClient.readContract({
        address: registryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: 'getAgentByAddress',
        args: [address]
      }) as [bigint, string, bigint];

      // Fetch metadata from IPFS
      const metadata = await fetchFromIPFS(metadataUri) as AgentIdentityMetadata;

      return {
        agentId: `agent-${tokenId}`,
        address,
        metadata,
        registeredAt: Number(registeredAt),
        tokenId
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Agent Discovery
  // ===========================================================================

  /**
   * Search for agents matching filters
   * Note: In production, this would use an indexer or subgraph
   */
  async searchAgents(filters: AgentSearchFilters): Promise<RegisteredAgent[]> {
    // This is a simplified implementation
    // In production, you would query a subgraph or indexer
    console.log('  [Mock] Searching agents with filters:', filters);

    // Return empty for now - would need indexer integration
    return [];
  }

  // ===========================================================================
  // Reputation Management
  // ===========================================================================

  /**
   * Give feedback to another agent
   */
  async giveFeedback(
    toAddress: Address,
    score: -1 | 0 | 1,
    comment: string = '',
    context: string = ''
  ): Promise<{ txHash: string }> {
    const reputationAddress = this.config.reputationAddress || Agent0Client.DEFAULT_REPUTATION;

    // In local/demo mode (no reputation contract deployed), simulate feedback
    // This path doesn't need a wallet client at all
    if (reputationAddress === Agent0Client.DEFAULT_REPUTATION) {
      console.log(`  [Simulated] Feedback to ${toAddress}: score=${score}, comment="${comment}"`);
      return { txHash: '0x' + '0'.repeat(64) };
    }

    // Only require wallet for real on-chain feedback
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet client not initialized. Provide privateKey in config.');
    }

    const hash = await this.walletClient.writeContract({
      chain: sepolia,
      account: this.account,
      address: reputationAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'giveFeedback',
      args: [toAddress, score, comment, context]
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    return { txHash: hash };
  }

  /**
   * Get reputation summary for an agent
   */
  async getReputationSummary(address: Address): Promise<ReputationSummary> {
    const reputationAddress = this.config.reputationAddress || Agent0Client.DEFAULT_REPUTATION;

    if (reputationAddress === Agent0Client.DEFAULT_REPUTATION) {
      // Return mock reputation
      return {
        agentId: `agent-${address.slice(0, 10)}`,
        address,
        totalFeedback: 0,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        averageScore: 0,
        recentFeedback: []
      };
    }

    const [positiveCount, negativeCount, neutralCount] = await this.publicClient.readContract({
      address: reputationAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'getReputationScore',
      args: [address]
    }) as [bigint, bigint, bigint];

    const total = Number(positiveCount) + Number(negativeCount) + Number(neutralCount);
    const avgScore = total > 0
      ? (Number(positiveCount) - Number(negativeCount)) / total
      : 0;

    return {
      agentId: `agent-${address.slice(0, 10)}`,
      address,
      totalFeedback: total,
      positiveCount: Number(positiveCount),
      negativeCount: Number(negativeCount),
      neutralCount: Number(neutralCount),
      averageScore: avgScore,
      recentFeedback: [] // Would need event indexing
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get the current account address
   */
  getAddress(): Address | undefined {
    return this.account?.address;
  }

  /**
   * Upload image to IPFS for agent avatar
   */
  async uploadImage(imageData: Buffer | Blob, filename: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', imageData, filename);
    formData.append('pinataMetadata', JSON.stringify({ name: filename }));

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.pinataJwt}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.statusText}`);
    }

    const result = await response.json() as PinataResponse;
    return `ipfs://${result.IpfsHash}`;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Agent0 client instance
 */
export function createAgent0Client(config: Agent0ClientConfig): Agent0Client {
  return new Agent0Client(config);
}

export default Agent0Client;
