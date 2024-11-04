// Script to deploy the contract to mainnet
// Schema can be manually overridden in the generated client
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { decodeAddress, encodeUint64 } from 'algosdk';
import { AlgoDirectoryFactory } from '../contracts/clients/AlgoDirectoryClient';

// For network-based template variables substitution at compile time
const CREATOR = 'MAINNET_DIRECTORY_CREATOR';
const FEE_SINK_ADDRESS = process.env.MAINNET_FEE_SINK_ADDRESS;
const NFD_REGISTRY_APP_ID = Number(process.env.MAINNET_NFD_REGISTRY_APP_ID);
const DIRECTORY_APP_ID = Number(process.env.MAINNET_DIRECTORY_DOT_ALGO_APP_ID);
const UPDATE_TOKEN = Number(process.env.MAINNET_UPDATE_TOKEN_ASA_ID);
const ADMIN_TOKEN = Number(process.env.MAINNET_ADMIN_TOKEN_ASA_ID);

const algorandMainnet = AlgorandClient.mainNet();

async function main() {
  const creator = await algorandMainnet.account.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }));
  const typedFactory = algorandMainnet.client.getTypedAppFactory(AlgoDirectoryFactory, {
    defaultSender: creator.addr,
  });

  // Create the smart contract application with network-specific template vars
  const { result: deployResult, appClient: creatorTypedAppClient } = await typedFactory.deploy({
    appName: 'AlgoDirectory',
    createParams: { method: 'createApplication', args: [], extraProgramPages: 3 },
    updateParams: { method: 'updateApplication', args: [] },
    onSchemaBreak: 'append',
    onUpdate: 'update',
    populateAppCallResources: true,
    deployTimeParams: {
      feeSinkAddress: decodeAddress(FEE_SINK_ADDRESS!).publicKey,
      nfdRegistryAppID: encodeUint64(NFD_REGISTRY_APP_ID),
      directoryAppID: encodeUint64(DIRECTORY_APP_ID),
      updateToken: encodeUint64(UPDATE_TOKEN),
    },
  });

  console.log('Result: ', deployResult);

  // Set the admin token ASA ID in the contract's global state
  const setAdminTokenResult = await creatorTypedAppClient.send.setAdminToken({
    args: { asaId: ADMIN_TOKEN },
    populateAppCallResources: true,
  });
  console.debug('Set admin token in contract result: ', setAdminTokenResult.transaction.txID());
}

// Call the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
