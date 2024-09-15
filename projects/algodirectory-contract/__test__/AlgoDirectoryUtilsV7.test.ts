/* eslint-disable no-console */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { ClientManager } from '@algorandfoundation/algokit-utils/types/client-manager';
import { makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { AccountManager } from '@algorandfoundation/algokit-utils/types/account-manager';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { AlgoDirectoryClient, APP_SPEC } from '../contracts/clients/AlgoDirectoryClient';

const CREATOR = 'CREATOR';
const CREATOR_SEGMENT_APPID = (process.env.CREATOR_SEGMENT_APP_ID || 576232891) as number; // test.directory.algo
const DAVE = 'DAVE';
const DAVE_SEGEMENT_APPID = (process.env.DAVE_SEGMENT_APP_ID || 673442367) as number; // test.directory.algo
const BETH = 'BETH';
const BETH_SEGMENT_APPID = (process.env.DAVE_SEGMENT_APP_ID || 606016435) as number; // beth.directory.algo

const algorand = AlgorandClient.testNet();

describe('AlgoDirectory', () => {
  beforeAll(async () => {
    const creator = await algorand.account.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }));
    const factory = algorand.client.getAppFactory({
      appSpec: APP_SPEC,
      defaultSender: creator.addr,
    });
    const { result, app } = await factory.deploy({
      createParams: {
        method: 'createApplication',
        args: [],
      },
    });
    console.debug('Deploy result operation: ', result.operationPerformed);
    console.debug(`Deployed app ${app.appId} at address: ${app.appAddress}`);

    // Fund the app MBR
    const fundResult = await app.fundAppAccount({ amount: (0.1).algos() });
    console.debug('Fund app result: ', fundResult.txIds);

    // Create the admin token
    const createAssetResult = await algorand.send.assetCreate({
      sender: creator.addr,
      assetName: 'directoryAdmin',
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
    const createdAsset = createAssetResult.confirmation.assetIndex;
    console.debug('Asset send result: ', createAssetResult.txIds);
    console.debug('Asset created: ', createdAsset);

    // // Set the admin token in the contract
    // const setAdminTokenResult = await creatorAppClient.setAdminToken({
    //   asaId: createdAsset!,
    // });
    // console.debug('Set admin token result: ', setAdminTokenResult.transaction.txID());

    // // Beth opts into the admin token
    // const bethAccount = (await accountManager.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }))).account;
    // algorand.setSignerFromAccount(bethAccount);
    // const optInResult = await algorand.send.assetOptIn({
    //   sender: bethAccount.addr,
    //   assetId: BigInt(createdAsset!),
    // });
    // console.debug('Asset send result: ', optInResult.txIds);

    // // Send one of the admin tokens to Beth
    // algorand.setSignerFromAccount(creatorAccount);
    // const sendAssetResult = await algorand.send.assetTransfer({
    //   sender: creatorAccount.addr,
    //   receiver: bethAccount.addr,
    //   assetId: BigInt(createdAsset!),
    //   amount: 1n,
    // });
    // console.debug('Asset send result: ', sendAssetResult.txIds);
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
