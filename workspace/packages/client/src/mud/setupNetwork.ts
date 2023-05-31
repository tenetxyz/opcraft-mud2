import { setupMUDV2Network, createActionSystem } from "@latticexyz/std-client";
import { Entity ,getComponentValue } from "@latticexyz/recs";
import { createFastTxExecutor, createFaucetService, getSnapSyncRecords, createRelayStream } from "@latticexyz/network";
import { getNetworkConfig } from "./getNetworkConfig";
import { defineContractComponents } from "./contractComponents";
import { world } from "./world";
import { createPerlin } from "@latticexyz/noise";
import { BigNumber, Contract, Signer, utils } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import { IWorld__factory } from "contracts/types/ethers-contracts/factories/IWorld__factory";
import { getTableIds, awaitPromise, computedToStream, VoxelCoord } from "@latticexyz/utils";
import { map, timer, combineLatest, BehaviorSubject } from "rxjs";
import storeConfig from "contracts/mud.config";
import { BlockIdToKey, BlockType } from "../layers/network/constants"
import {
  getECSBlock,
  getTerrain,
  getTerrainBlock,
  getBlockAtPosition as getBlockAtPositionApi,
  getEntityAtPosition as getEntityAtPositionApi,
  getBiome,
} from "../layers/network/api";

export type SetupNetworkResult = Awaited<ReturnType<typeof setupNetwork>>;

export async function setupNetwork() {
  const contractComponents = defineContractComponents(world);
  const networkConfig = await getNetworkConfig();
  const result = await setupMUDV2Network<typeof contractComponents, typeof storeConfig>({
    networkConfig,
    world,
    contractComponents,
    syncThread: "main",
    storeConfig,
    worldAbi: IWorld__factory.abi,
  });
  console.log("Finished setupMUDV2Network");

  const signer = result.network.signer.get();
  const playerAddress = result.network.connectedAddress.get();

  // Relayer setup
  let relay: Awaited<ReturnType<typeof createRelayStream>> | undefined;
  try {
    console.log("Starting relay setup");
    // relay =
    // networkConfig.relayServiceUrl && playerAddress && signer
    //     ? await createRelayStream(signer, networkConfig.relayServiceUrl, playerAddress)
    //     : undefined;
    relay = undefined;
  } catch (e) {
    console.error(e);
  }

  relay && world.registerDisposer(relay.dispose);
  if (relay) console.info("[Relayer] Relayer connected: " + networkConfig.relayServiceUrl);
  console.log("Finished relay setup");


  // Request drip from faucet
  let faucet: any = undefined;
  if (networkConfig.faucetServiceUrl && signer) {
    const address = await signer.getAddress();
    console.info("[Dev Faucet]: Player address -> ", address);

    faucet = createFaucetService(networkConfig.faucetServiceUrl);

    const requestDrip = async () => {
      const balance = await signer.getBalance();
      console.info(`[Dev Faucet]: Player balance -> ${balance}`);
      const lowBalance = balance?.lte(utils.parseEther("1"));
      if (lowBalance) {
        console.info("[Dev Faucet]: Balance is low, dripping funds to player");
        // Double drip
        await faucet.dripDev({ address });
        await faucet.dripDev({ address });
      }
    };

    requestDrip();
    // Request a drip every 20 seconds
    setInterval(requestDrip, 20000);
  }

  // TODO: Uncomment once we support plugins
  // // Set initial component values
  // if (components.PluginRegistry.entities.length === 0) {
  //   addPluginRegistry("https://opcraft-plugins.mud.dev");
  // }
  // // Enable chat plugin by default
  // if (
  //   getEntitiesWithValue(components.Plugin, { host: "https://opcraft-plugins.mud.dev", path: "/chat.js" }).size === 0
  // ) {
  //   console.info("Enabling chat plugin by default");
  //   addPlugin({
  //     host: "https://opcraft-plugins.mud.dev",
  //     path: "/chat.js",
  //     active: true,
  //     source: "https://github.com/latticexyz/opcraft-plugins",
  //   });
  // }

  const provider = result.network.providers.get().json;
  const signerOrProvider = signer ?? provider;
  // Create a World contract instance
  const worldContract = IWorld__factory.connect(networkConfig.worldAddress, signerOrProvider);
  const uniqueWorldId = networkConfig.chainId + networkConfig.worldAddress;

  if (networkConfig.snapSync) {
    const currentBlockNumber = await provider.getBlockNumber();
    const tableRecords = await getSnapSyncRecords(
      networkConfig.worldAddress,
      getTableIds(storeConfig),
      currentBlockNumber,
      signerOrProvider
    );

    console.log(`Syncing ${tableRecords.length} records`);
    result.startSync(tableRecords, currentBlockNumber);
  } else {
    result.startSync();
  }

  // Create a fast tx executor
  const fastTxExecutor =
    signer?.provider instanceof JsonRpcProvider
      ? await createFastTxExecutor(signer as Signer & { provider: JsonRpcProvider })
      : null;

  // TODO: infer this from fastTxExecute signature?
  type BoundFastTxExecuteFn<C extends Contract> = <F extends keyof C>(
    func: F,
    args: Parameters<C[F]>,
    options?: {
      retryCount?: number;
    }
  ) => Promise<ReturnType<C[F]>>;

  function bindFastTxExecute<C extends Contract>(contract: C): BoundFastTxExecuteFn<C> {
    return async function (...args) {
      if (!fastTxExecutor) {
        throw new Error("no signer");
      }
      const { tx } = await fastTxExecutor.fastTxExecute(contract, ...args);
      return await tx;
    };
  }

  const worldSend = bindFastTxExecute(worldContract);

  console.log("till here 1");

  // --- ACTION SYSTEM --------------------------------------------------------------
  const actions = createActionSystem<{
    actionType: string;
    coord?: VoxelCoord;
    blockType?: keyof typeof BlockType;
  }>(world, result.txReduced$);

  // TODO: How do you do this in MUD2?
  // Add indexers and optimistic updates
  // const { withOptimisticUpdates } = actions;
  // components.Position = createIndexer(withOptimisticUpdates(components.Position));
  // components.OwnedBy = createIndexer(withOptimisticUpdates(components.OwnedBy));
  // components.Item = withOptimisticUpdates(components.Item);

  // --- API ------------------------------------------------------------------------

  console.log("till here 2");

  const perlin = await createPerlin();
  console.log("till here 2.1");

  const terrainContext = {
    Position: contractComponents.Position,
    Item: contractComponents.Item,
    world,
  };

  function getTerrainBlockAtPosition(position: VoxelCoord) {
    return getTerrainBlock(getTerrain(position, perlin), position, perlin);
  }

  function getECSBlockAtPosition(position: VoxelCoord) {
    return getECSBlock(terrainContext, position);
  }
  function getBlockAtPosition(position: VoxelCoord) {
    return getBlockAtPositionApi(terrainContext, perlin, position);
  }
  function getEntityAtPosition(position: VoxelCoord) {
    return getEntityAtPositionApi(terrainContext, position);
  }

  function build(entity: Entity, coord: VoxelCoord) {
    // const entityIndex = world.entityToIndex.get(entity);
    // if (entityIndex == null) return console.warn("trying to place unknown entity", entity);
    const blockId = getComponentValue(contractComponents.Item, entity)?.value;
    const blockType = blockId != null ? BlockIdToKey[blockId as Entity] : undefined;
    // const godIndex = world.entityToIndex.get(GodID);
    // const creativeMode = godIndex != null && getComponentValue(components.GameConfig, godIndex)?.creativeMode;

    actions.add({
      id: `build+${coord.x}/${coord.y}/${coord.z}` as Entity,
      metadata: { actionType: "build", coord, blockType },
      requirement: () => true,
      components: { Position: contractComponents.Position, Item: contractComponents.Item, OwnedBy: contractComponents.OwnedBy },
      execute: () =>
      // TODO: do we need BigNumber? I don't think so
        worldSend("build", [BigNumber.from(entity), coord]),
      updates: () => [
        // {
        //   component: "OwnedBy",
        //   entity: entityIndex,
        //   value: { value: GodID },
        // },
        // {
        //   component: "Position",
        //   entity: entityIndex,
        //   value: coord,
        // },
      ],
    });
  }

  console.log("till here 2.5");

  // --- STREAMS --------------------------------------------------------------------
  const balanceGwei$ = new BehaviorSubject<number>(1);
  world.registerDisposer(
    combineLatest([timer(0, 5000), computedToStream(result.network.signer)])
      .pipe(
        map<[number, Signer | undefined], Promise<number>>(async ([, signer]) =>
          signer
            ? signer.getBalance().then((v) => v.div(BigNumber.from(10).pow(9)).toNumber())
            : new Promise((res) => res(0))
        ),
        awaitPromise()
      )
      .subscribe(balanceGwei$)?.unsubscribe
  );

  console.log("till here 3");

  const connectedClients$ = timer(0, 5000).pipe(
    map(async () => relay?.countConnected() || 0),
    awaitPromise()
  );

  console.log("till here return");

  return {
    ...result,
    world,
    worldContract,
    actions,
    api: {
      getTerrainBlockAtPosition,
      getECSBlockAtPosition,
      getBlockAtPosition,
      getEntityAtPosition,
      build,
    }, // TODO: populate?
    worldSend: worldSend,
    fastTxExecutor,
    // dev: setupDevSystems(world, encoders as Promise<any>, systems),
    streams: { connectedClients$, balanceGwei$ },
    config: networkConfig,
    relay,
    faucet,
    worldAddress: networkConfig.worldAddress,
    uniqueWorldId,
    types: { BlockIdToKey, BlockType },
  };
}
