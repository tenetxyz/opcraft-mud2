import { SetupContractConfig, getBurnerWallet } from "@latticexyz/std-client";
import worldsJson from "contracts/worlds.json";
import { supportedChains } from "./supportedChains";

const worlds = worldsJson as Partial<Record<string, { address: string; blockNumber?: number }>>;

type NetworkConfig = SetupContractConfig & {
  privateKey: string;
  faucetServiceUrl?: string;
  snapSync?: boolean;
  relayServiceUrl?: string;
};

const defaultParams = {
  chainId: "4242",
  worldAddress: "0xc1c15CCE34E16684d36B0F76B9fa4f74b3a279f4",
  rpc: "https://follower.testnet-chain.linfra.xyz",
  wsRpc: "wss://follower.testnet-chain.linfra.xyz",
  initialBlockNumber: "1443526",
  snapshot: "https://ecs-snapshot.testnet-mud-services.linfra.xyz",
  stream: "https://ecs-stream.testnet-mud-services.linfra.xyz",
  relay: "https://ecs-relay.testnet-mud-services.linfra.xyz",
  faucet: "https://faucet.testnet-mud-services.linfra.xyz",
  blockTime: "1000",
  blockExplorer: "https://explorer.testnet-chain.linfra.xyz",
  dev: "false",
};

export async function getNetworkConfig(): Promise<NetworkConfig> {
  const params = new URLSearchParams(window.location.search);

  const chainId = Number(params.get("chainId") || import.meta.env.VITE_CHAIN_ID || 31337);
  const chainIndex = supportedChains.findIndex((c) => c.id === chainId);
  const chain = supportedChains[chainIndex];
  if (!chain) {
    throw new Error(`Chain ${chainId} not found`);
  }

  const world = worlds[chain.id.toString()];
  const worldAddress = params.get("worldAddress") || world?.address;
  if (!worldAddress) {
    throw new Error(`No world address found for chain ${chainId}. Did you run \`mud deploy\`?`);
  }

  const initialBlockNumber = params.has("initialBlockNumber")
    ? Number(params.get("initialBlockNumber"))
    : world?.blockNumber ?? -1; // -1 will attempt to find the block number from RPC

  return {
    clock: {
      period: 1000,
      initialTime: 0,
      syncInterval: 5000,
    },
    provider: {
      chainId,
      jsonRpcUrl: params.get("rpc") ?? chain.rpcUrls.default.http[0],
      wsRpcUrl: params.get("wsRpc") ?? chain.rpcUrls.default.webSocket?.[0],
    },
    privateKey: getBurnerWallet().value,
    chainId,
    modeUrl: params.get("mode") ?? chain.modeUrl,
    faucetServiceUrl: params.get("faucet") ?? chain.faucetUrl,
    worldAddress,
    initialBlockNumber,
    snapSync: params.get("snapSync") === "true",
    disableCache: params.get("cache") === "false",
    relayServiceUrl: params.get("relay") ?? defaultParams.relay
  };
}