/* eslint-disable no-console */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { decodeAddress, encodeAddress, encodeUint64 } from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { AlgoDirectoryClient, AlgoDirectoryFactory } from '../contracts/clients/AlgoDirectoryClient';

// Get env vars from .env, defaulting to testnet values

// For network-based template variables substitution at compile time
const FEE_SINK_ADDRESS = process.env.FEE_SINK_ADDRESS || 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'; // Testnet A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE / Mainnet Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA
const NFD_REGISTRY_APP_ID = Number(process.env.NFD_REGISTRY_APP_ID); // Testnet 84366825 / Mainnet 760937186
const DIRECTORY_DOT_ALGO_APP_ID = Number(process.env.DIRECTORY_DOT_ALGO_APP_ID); // Testnet 576232821 / Mainnet 766401564

// For testing purposes
const CREATOR = 'CREATOR';
const DAVE = 'DAVE';
const DAVE_SEGMENT_APP_ID = Number(process.env.DAVE_SEGMENT_APP_ID); // dave.directory.algo
const BETH = 'BETH';
// const BETH_SEGMENT_APP_ID = Number(process.env.BETH_SEGMENT_APP_ID); // beth.directory.algo

// Put an existing admin asset held by CREATOR & BETH in .env to use that, else a new one will be created
const ADMIN_TOKEN_ASA_ID = BigInt(Number(process.env.ADMIN_TOKEN_ASA_ID)); // Testnet 721940792 / Mainnet TBD

const algorand = AlgorandClient.testNet();

let deployedAppID: bigint;
let deployedAppAddress: string;

describe('AlgoDirectory', () => {
  beforeAll(async () => {
    const creator = await algorand.account.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }));
    const typedFactory = algorand.client.getTypedAppFactory(AlgoDirectoryFactory, {
      defaultSender: creator.addr,
    });

    const { result, app: creatorTypedAppClient } = await typedFactory.deploy({
      createParams: { method: 'createApplication', args: [] },
      updateParams: { method: 'updateApplication', args: [] },
      onSchemaBreak: 'replace',
      onUpdate: 'update',
      deployTimeParams: {
        feeSinkAddress: decodeAddress(FEE_SINK_ADDRESS).publicKey,
        nfdRegistryAppID: encodeUint64(NFD_REGISTRY_APP_ID),
        directoryAppID: encodeUint64(DIRECTORY_DOT_ALGO_APP_ID),
      },
    });

    deployedAppID = creatorTypedAppClient.appClient.appId;
    deployedAppAddress = creatorTypedAppClient.appClient.appAddress;
    console.debug('Deploy result operation: ', result.operationPerformed);
    console.debug(
      `Deployed app ${creatorTypedAppClient.appClient.appId} at address: ${creatorTypedAppClient.appClient.appAddress}`
    );

    // If a new app was created, fund the app MBR
    if (result.operationPerformed === 'create') {
      const fundResult = await creatorTypedAppClient.appClient.fundAppAccount({ amount: (0.1).algos() });
      console.debug('Fund app result: ', fundResult.txIds);
    }

    // Very simple idempotent approach to checking if CREATOR already
    // holds the admin token from .env and creating one, if not
    let adminAsset: bigint = ADMIN_TOKEN_ASA_ID;
    console.debug('Admin token from .env: ', adminAsset);
    const creatorAccountInfo = await algorand.account.getInformation(creator.addr);
    // console.debug('Account info: ', creatorAccountInfo);
    const existingAdminTokenFound = creatorAccountInfo.assets?.find(
      (asset) => BigInt(asset.assetId) === ADMIN_TOKEN_ASA_ID
    );
    console.debug('Existing admin token found: ', existingAdminTokenFound);

    // Create a new admin token if the one from .env isn't found in CREATOR's account

    if (!existingAdminTokenFound) {
      const createAssetResult = await algorand.send.assetCreate({
        sender: creator.addr,
        assetName: `Directory Admin (App ${creatorTypedAppClient.appClient.appId})`,
        unitName: 'DA',
        total: 10n,
        decimals: 0,
        url: 'directory.algo.xyz',
        defaultFrozen: false,
        manager: creator.addr,
        reserve: creator.addr,
        freeze: creator.addr,
        clawback: creator.addr,
      });
      adminAsset = createAssetResult.assetId;
      console.debug('Asset send result: ', createAssetResult.txIds);
      console.debug('Asset created: ', adminAsset);

      // BETH opts into the new admin asset
      const beth = await algorand.account.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }));
      algorand.setSignerFromAccount(beth);
      const optInResult = await algorand.send.assetOptIn({
        sender: beth.addr,
        assetId: adminAsset,
      });
      console.debug('Beth opt into new admin asset result: ', optInResult.txIds);

      // CREATOR sends one of the admin tokens to BETH
      algorand.setSignerFromAccount(creator);
      const sendAssetResult = await algorand.send.assetTransfer({
        sender: creator.addr,
        receiver: beth.addr,
        assetId: adminAsset,
        amount: 1n,
      });
      console.debug('Send new admin asset to Beth result: ', sendAssetResult.txIds);
    }

    // Very simple idempotent approach to checking if the admin asset is
    // already set in the contract state and setting it, if not
    const contractAdminAsset = await creatorTypedAppClient.state.global.adminToken();
    // If contract has an old admin asset ID in storage, overwrite it with the new asset
    if (contractAdminAsset !== adminAsset) {
      const setAdminTokenResult = await creatorTypedAppClient.send.setAdminToken({ args: { asaId: adminAsset } });
      console.debug('Set admin token in contract result: ', setAdminTokenResult.transaction.txID());
    }
  });

  // Blank test to run beforeAll
  test('runBeforeAll', () => {});

  /* ****************
  Positive test cases
  **************** */

  // Create a listing and confirm that the two boxes are created as we expect
  test('daveCreateListing', async () => {
    // Dave is going to create a listing for dave.directory.algo
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: dave.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    const result = await daveTypedClient.send.createListing({
      args: {
        collateralPayment: payTxn,
        nfdAppId: DAVE_SEGMENT_APP_ID,
        listingTags: new Uint8Array(13),
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug('Create listing return: ', result.return);

    expect(result.confirmations?.length).toBe(2);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Refresh an existing listing and confirm that the timestamp has been updated
  test('daveRefreshListing', async () => {
    // Dave is going to refresh his listing for dave.directory.algo
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveAppClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    const result = await daveAppClient.send.refreshListing({
      args: {
        nfdAppId: DAVE_SEGMENT_APP_ID,
      },
      populateAppCallResources: true,
    });
    console.debug('Refresh return: ', result.return);

    expect(result.confirmations?.length).toBe(1);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Abandon a listing and confirm that the vouched collateral is returned
  test('daveAbandonListing', async () => {
    // Dave is going to abandon his listing for dave.directory.algo
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveAppClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    const result = await daveAppClient.send.abandonListing({
      args: {
        nfdAppId: DAVE_SEGMENT_APP_ID,
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    }); // No return value expected

    expect(result.confirmations?.length).toBe(1);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Create a listing, then delete it and confirm that the collateral is sent to the fee sink
  test('daveCreateThenCreatorDelete', async () => {
    // Step 1: Dave is going to create a listing for dave.directory.algo
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: dave.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    const createResult = await daveTypedClient.send.createListing({
      args: {
        collateralPayment: payTxn,
        nfdAppId: DAVE_SEGMENT_APP_ID,
        listingTags: new Uint8Array(13),
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug('Create listing return: ', createResult.return);

    expect(createResult.confirmations?.length).toBe(2);
    expect(createResult.confirmation?.confirmedRound).toBeGreaterThan(0);

    // Step 2: Creator is now going to delete Dave's listing for dave.directory.algo
    const creator = await algorand.account.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(creator);
    const creatorTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: creator.addr,
    });

    const deleteResult = await creatorTypedClient.send.deleteListing({
      args: {
        nfdAppId: DAVE_SEGMENT_APP_ID,
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug('Delete listing return: ', deleteResult.return);

    expect(deleteResult.confirmations?.length).toBe(1);
    expect(deleteResult.confirmation?.confirmedRound).toBeGreaterThan(0);
    expect(encodeAddress(Uint8Array.from(deleteResult.confirmation!.innerTxns![0].txn.txn.rcv!))).toBe(
      FEE_SINK_ADDRESS
    );
  });

  /* ****************
  Negative test cases
  **************** */

  // Attempt to CREATE a listing with insufficient payment; expect failure
  // test("Test description", () => {
  //   const t = () => {
  //     throw new TypeError();
  //   };
  //   expect(t).toThrow(TypeError);
  // });

  // Attempt to CREATE a listing that is not a segment of directory.algo; expect failure

  // Attempt to CREATE a listing for an NFD the caller doesn't own; expect failure (DAVE create for beth.directory.algo)

  // Attempt to CREATE a listing for an expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)

  // Attempt to CREATE a listing for an NFD that is listed for sale; expect failure

  // Attempt to REFRESH a listing for an NFD the caller doesn't own; expect failure (DAVE create listing and BETH attempt to refresh it)

  // Attempt to REFRESH a listing with expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)

  // Attempt to REFRESH a listing for an NFD that is listed for sale; expect failure

  // Attempt to ABANDON a listing that the caller doesn't own; expect failure (DAVE create listing and BETH attempt to abandon it)
  // If an NFD has expired, let the new owner abandon the old listing and refund the original listing owner

  // Attempt to DELETE a listing without having the admin token; expect failure (BETH create listing and DAVE attempt to delete it)
});
