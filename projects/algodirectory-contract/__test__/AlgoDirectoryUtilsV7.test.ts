/* eslint-disable no-console */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { encodeUint64 } from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { AlgoDirectoryFactory } from '../contracts/clients/AlgoDirectoryClient';

// Get env vars from .env, defaulting to testnet values

// For network-based template variables substitution at compile time
const FEE_SINK_ADDRESS = process.env.FEE_SINK_ADDRESS || 'A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE'; // Testnet A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE / Mainnet Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA
const NFD_REGISTRY_APP_ID = Number(process.env.NFD_REGISTRY_APP_ID); // Testnet 84366825 / Mainnet 760937186
const DIRECTORY_DOT_ALGO_APP_ID = Number(process.env.DIRECTORY_DOT_ALGO_APP_ID); // Testnet 576232821 / Mainnet 766401564

// For testing purposes
const CREATOR = 'CREATOR';
const CREATOR_SEGMENT_APPID = Number(process.env.CREATOR_SEGMENT_APP_ID); // test.directory.algo
const DAVE = 'DAVE';
const DAVE_SEGEMENT_APPID = Number(process.env.DAVE_SEGMENT_APP_ID); // test.directory.algo
const BETH = 'BETH';
const BETH_SEGMENT_APPID = Number(process.env.DAVE_SEGMENT_APP_ID); // beth.directory.algo

// Put an existing admin asset held by CREATOR & BETH in .env to use that, else a new one will be created
const ADMIN_TOKEN_ASAID = Number(process.env.ADMIN_TOKEN_ASAID); // Testnet 721940792 / Mainnet TBD

const algorand = AlgorandClient.testNet();

describe('AlgoDirectory', () => {
  beforeAll(async () => {
    const creator = await algorand.account.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }));
    const typedFactory = algorand.client.getTypedAppFactory(AlgoDirectoryFactory, {
      defaultSender: creator.addr,
      deployTimeParams: {
        feeSinkAddress: FEE_SINK_ADDRESS,
        nfdRegistryAppID: encodeUint64(NFD_REGISTRY_APP_ID),
        directoryDotAlgoAppID: encodeUint64(DIRECTORY_DOT_ALGO_APP_ID),
      },
    });

    const { result, app: typedAppClient } = await typedFactory.deploy({
      createParams: { method: 'createApplication', args: [] },
      updateParams: { method: 'updateApplication', args: [] },
      onSchemaBreak: 'replace',
      onUpdate: 'append',
      deployTimeParams: {
        feeSinkAddress: FEE_SINK_ADDRESS,
        nfdRegistryAppID: encodeUint64(NFD_REGISTRY_APP_ID),
        directoryDotAlgoAppID: encodeUint64(DIRECTORY_DOT_ALGO_APP_ID),
      },
    });
    console.debug('Deploy result operation: ', result.operationPerformed);
    console.debug(`Deployed app ${typedAppClient.appClient.appId} at address: ${typedAppClient.appClient.appAddress}`);

    // If a new app was created, fund the app MBR
    if (result.operationPerformed === 'create') {
      const fundResult = await typedAppClient.appClient.fundAppAccount({ amount: (0.1).algos() });
      console.debug('Fund app result: ', fundResult.txIds);
    }

    // Very simple idempotent approach to checking if CREATOR already
    // holds the admin token from .env and creating one, if not
    const creatorAccountInfo = await algorand.account.getInformation(creator.addr);
    console.debug('Account info: ', creatorAccountInfo);
    const existingAdminToken = creatorAccountInfo.assets?.find((asset) => asset.assetId === ADMIN_TOKEN_ASAID);
    console.debug('Existing admin token found: ', existingAdminToken);

    // Create a new admin token if the one from .env isn't found in CREATOR's account
    let adminAsset: bigint;
    if (!existingAdminToken) {
      const createAssetResult = await algorand.send.assetCreate({
        sender: creator.addr,
        assetName: `Directory Admin (App ${typedAppClient.appClient.appId})`,
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

      // Very simple idempotent approach to checking if the admin asset is
      // already set in the contract state and setting it, if not
      const contractAdminAsset = await typedAppClient.state.global.adminToken();
      // If contract has an old admin asset ID in storage, overwrite it with the new asset
      if (contractAdminAsset !== adminAsset) {
        const setAdminTokenResult = await typedAppClient.send.setAdminToken({ args: { asaId: adminAsset } });
        console.debug('Set admin token in contract result: ', setAdminTokenResult.transaction.txID());
      }

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
        assetId: BigInt(adminAsset),
        amount: 1n,
      });
      console.debug('Send new admin asset to Beth result: ', sendAssetResult.txIds);
    }
  });

  // Blank test to run beforeAll
  test('blank test', () => {});

  /* ****************
  Positive test cases
  **************** */

  // // Create a listing and confirm that the two boxes are created as we expect
  // test('createListing', async () => {
  //   // Dave is going to create a listing for dave.directory.algo
  //   const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
  //   const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(daveAccount);
  //   const daveAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: daveAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const suggestedParams = await algorand.getSuggestedParams();
  //   const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
  //     from: daveAccount.addr,
  //     to: deployedAppAddress,
  //     amount: new AlgoAmount({ microAlgos: 72200 }).microAlgos, // Each listing 72_200 uA
  //     suggestedParams,
  //   });

  //   const result = await daveAppClient.createListing(
  //     {
  //       collateralPayment: payTxn,
  //       nfdAppId: DAVE_SEGEMENT_APPID,
  //       listingTags: new Uint8Array(13),
  //     },
  //     {
  //       sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
  //     }
  //   );
  //   console.debug('Create txID: ', result.transaction.txID());
  //   console.debug('Create return: ', result.return);

  //   expect(result.confirmations?.length).toBe(2);
  //   expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  // });

  // // Refresh an existing listing and confirm that the timestamp has been updated
  // test('refreshListing', async () => {
  //   // Dave is going to refresh his listing for dave.directory.algo
  //   const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
  //   const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(daveAccount);
  //   const daveAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: daveAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const result = await daveAppClient.refreshListing({
  //     nfdAppId: DAVE_SEGEMENT_APPID,
  //   });
  //   console.debug('Refresh txID: ', result.transaction.txID());
  //   console.debug('Refresh return: ', result.return);

  //   expect(result.confirmations?.length).toBe(1);
  //   expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  // });

  // // Abandon a listing and confirm that the vouched collateral is returned
  // test('abandonListing', async () => {
  //   // Dave is going to abandon his listing for dave.directory.algo
  //   const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
  //   const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(daveAccount);
  //   const daveAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: daveAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const result = await daveAppClient.abandonListing(
  //     {
  //       nfdAppId: DAVE_SEGEMENT_APPID,
  //     },
  //     {
  //       sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
  //     }
  //   );
  //   console.debug('Abandon txID: ', result.transaction.txID());

  //   expect(result.confirmations?.length).toBe(1);
  //   expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  // });

  // // Create a listing, then delete it and confirm that the collateral is sent to the fee sink
  // test('creatorDeleteListing', async () => {
  //   // Step 1: Dave is going to create a listing for dave.directory.algo
  //   const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
  //   const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(daveAccount);
  //   const daveAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: daveAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const suggestedParams = await algorand.getSuggestedParams();
  //   const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
  //     from: daveAccount.addr,
  //     to: deployedAppAddress,
  //     amount: new AlgoAmount({ microAlgos: 72200 }).microAlgos, // Each listing 72_200 uA
  //     suggestedParams,
  //   });

  //   const createResult = await daveAppClient.createListing(
  //     {
  //       collateralPayment: payTxn,
  //       nfdAppId: DAVE_SEGEMENT_APPID,
  //       listingTags: new Uint8Array(13),
  //     },
  //     {
  //       sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
  //     }
  //   );
  //   console.debug('Create txID: ', createResult.transaction.txID());
  //   console.debug('Create return: ', createResult.return);

  //   expect(createResult.confirmations?.length).toBe(2);
  //   expect(createResult.confirmation?.confirmedRound).toBeGreaterThan(0);

  //   // Step 2: Creator is now going to delete Dave's listing for dave.directory.algo
  //   const creatorAccount = (await accountManager.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(creatorAccount);
  //   const creatorAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: creatorAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const deleteResult = await creatorAppClient.deleteListing(
  //     {
  //       nfdAppId: DAVE_SEGEMENT_APPID,
  //     },
  //     {
  //       sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
  //     }
  //   );
  //   console.debug('Creator delete txID: ', deleteResult.transaction.txID());

  //   expect(deleteResult.confirmations?.length).toBe(1);
  //   expect(deleteResult.confirmation?.confirmedRound).toBeGreaterThan(0);
  //   // TODO: expect the innerTxn receiver to be the fee sink
  // }); // Create a listing, then delete it and confirm that the collateral is sent to the fee sink

  // test('bethDeleteListing', async () => {
  //   // Step 1: Dave is going to create a listing for dave.directory.algo
  //   const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
  //   const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(daveAccount);
  //   const daveAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: daveAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const suggestedParams = await algorand.getSuggestedParams();
  //   const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
  //     from: daveAccount.addr,
  //     to: deployedAppAddress,
  //     amount: new AlgoAmount({ microAlgos: 72200 }).microAlgos, // Each listing 72_200 uA
  //     suggestedParams,
  //   });

  //   const createResult = await daveAppClient.createListing(
  //     {
  //       collateralPayment: payTxn,
  //       nfdAppId: DAVE_SEGEMENT_APPID,
  //       listingTags: new Uint8Array(13),
  //     },
  //     {
  //       sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
  //     }
  //   );
  //   console.debug('Create txID: ', createResult.transaction.txID());
  //   console.debug('Create return: ', createResult.return);

  //   expect(createResult.confirmations?.length).toBe(2);
  //   expect(createResult.confirmation?.confirmedRound).toBeGreaterThan(0);

  //   // Step 2: Beth is now going to delete Dave's listing for dave.directory.algo
  //   const bethAccount = (await accountManager.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }))).account;
  //   algorand.setSignerFromAccount(bethAccount);
  //   const creatorAppClient = new AlgoDirectoryClient(
  //     {
  //       sender: bethAccount,
  //       resolveBy: 'id',
  //       id: deployedAppID,
  //     },
  //     algorand.client.algod
  //   );

  //   const deleteResult = await creatorAppClient.deleteListing(
  //     {
  //       nfdAppId: DAVE_SEGEMENT_APPID,
  //     },
  //     {
  //       sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
  //     }
  //   );
  //   console.debug('Bethd delete txID: ', deleteResult.transaction.txID());

  //   expect(deleteResult.confirmations?.length).toBe(1);
  //   expect(deleteResult.confirmation?.confirmedRound).toBeGreaterThan(0);
  //   // TODO: expect the innerTxn receiver to be the fee sink
  // });

  /* ****************
  Negative test cases
  **************** */

  // Attempt to create a listing with insufficient payment; expect failure
  // test("Test description", () => {
  //   const t = () => {
  //     throw new TypeError();
  //   };
  //   expect(t).toThrow(TypeError);
  // });

  // Attempt to CREATE a listing that is not a segment of directory.algo; expect failure

  // Attempt to CREATE a listing for an NFD the caller doesn't own; expect failure (DAVE create for beth.directory.algo)

  // Attempt to CREATE a listing for an expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)

  // Attempt to REFRESH a listing for an NFD the caller doesn't own; expect failure (DAVE create listing and BETH attempt to refresh it)

  // Attempt to REFRESH a listing with expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)

  // Attempt to ABANDON a listing that the caller doesn't own; expect failure (DAVE create listing and BETH attempt to abandon it)

  // Attempt to DELETE a listing without having the admin token; expect failure (BETH create listing and DAVE attempt to delete it)
});
