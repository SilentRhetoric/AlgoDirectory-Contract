/* eslint-disable no-console */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { decodeAddress, encodeAddress, encodeUint64, decodeUnsignedTransaction } from 'algosdk';
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
const BETH_SEGMENT_APP_ID = Number(process.env.BETH_SEGMENT_APP_ID); // beth.directory.algo
const DAVE_NOT_SEGMENT_APP_ID = Number(process.env.DAVE_NOT_SEGMENT_APP_ID); // bob.directory.algo
const FORSALE_SEGMENT_APP_ID = Number(process.env.FORSALE_SEGMENT_APP_ID); // forsale.directory.algo
const FORSALE_WITH_LISTING_SEGMENT_APP_ID = Number(process.env.FORSALE_WITH_LISTING_SEGMENT_APP_ID); // forsalewithlisting.directory.algo

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

  // Create a listing for each scenario in the nested array
  test.each([
    [DAVE, DAVE_SEGMENT_APP_ID],
    [BETH, BETH_SEGMENT_APP_ID],
  ])('%s create listing for app %s', async (name, segmentAppID) => {
    const account = await algorand.account.fromEnvironment(name, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(account);
    const typedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: account.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: account.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    const result = await typedClient.send.createListing({
      args: {
        collateralPayment: payTxn,
        nfdAppId: segmentAppID,
        listingTags: new Uint8Array(13),
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug(`${name} create listing return: `, result.return);

    expect(result.confirmations?.length).toBe(2);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
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
  test('daveCreatesListingWithInsufficeintFunds', async () => {
    // Get Daves account and NFD ready for creating a new dave.directory.algo listing
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);

    // Dave is going to create a listing for dave.directory.algo, but he will not provide enough funds to cover
    // the total costs of the listing
    const daveTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: dave.addr,
      receiver: deployedAppAddress,
      amount: (72100).microAlgo(), // Each listing 72_200 uA so fund it 100 less
    });

    const t = async () => {
      try {
        await daveTypedClient.send.createListing({
          args: {
            collateralPayment: payTxn,
            nfdAppId: DAVE_SEGMENT_APP_ID,
            listingTags: new Uint8Array(13),
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.message.includes('opcodes=pushint 72200; >=; assert')) {
          throw new TypeError('Caller is not paying enough to vouch for the listing');
        } else {
          throw e;
        }
      }
    };
    // We expect the error message to be thrown
    await expect(t).rejects.toThrow('Caller is not paying enough to vouch for the listing');
    console.debug('Caller is not paying enough to vouch for the listing, expected error thrown!');
  });

  // Attempt to CREATE a listing that is not a segment of directory.algo; expect failure
  test('daveCreatesListingWithoutSegment', async () => {
    // Dave is going to create a listing for notdirectory.algo, but it's not a segment of directory.algo
    // For this test just provide an NFD that's not a segment of directory.algo with any account as DAVE
    // Make sure DAVE_NOT_SEGMENT_APP_ID is not a segment of directory.algo, but is owned by DAVE and not for sale
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

    const t = async () => {
      try {
        await daveTypedClient.send.createListing({
          args: {
            collateralPayment: payTxn,
            nfdAppId: DAVE_NOT_SEGMENT_APP_ID,
            listingTags: new Uint8Array(13),
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // Verified opcode is part of checkNFDIsSegmentOfDirectory in the teal code
        if (e.message.includes('opcodes=pushbytes 0x692e706172656e744170704944')) {
          throw new TypeError('NFD must be a segment of directory.algo');
        } else {
          throw e;
        }
      }
    };
    await expect(t).rejects.toThrow('NFD must be a segment of directory.algo');
    console.debug('NFD must be a segment of directory.algo, expected error thrown!');
  });

  // Attempt to CREATE a listing for an NFD the caller doesn't own; expect failure (DAVE create for beth.directory.algo)
  test('daveCreateListingForBethAndFails', async () => {
    // Dave is going to create a listing for beth.directory.algo
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
    payTxn.appForeignApps = [BETH_SEGMENT_APP_ID];

    const t = async () => {
      try {
        await daveTypedClient.send.createListing({
          args: {
            collateralPayment: payTxn,
            nfdAppId: BETH_SEGMENT_APP_ID,
            listingTags: new Uint8Array(13),
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.message.includes('opcodes=assert; ==; assert')) {
          throw new TypeError('Listing creator must be the NFD app i.owner.a');
        } else {
          throw e;
        }
      }
    };
    // We expect the error message to be thrown
    await expect(t).rejects.toThrow('Listing creator must be the NFD app i.owner.a');
    console.debug('Listing creator must be the NFD app i.owner.a, expected error thrown!');
  });

  // Attempt to CREATE a listing for an expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)
  /** Just need to figure out the betanet and expired NFD creation */

  // Attempt to CREATE a listing for an NFD that is listed for sale; expect failure
  test('bethCreatesListingWithForSaleSegment', async () => {
    // Beth is going to create a listing for forsale.directory.algo, she currently owns the segment, but
    // it is listed for sale. First we need to make sure the segment is listed for sale
    const nfdInfo = await fetch(
      `https://api.testnet.nf.domains/nfd/${FORSALE_SEGMENT_APP_ID}?view=brief&poll=false&nocache=false`,
      {
        method: 'GET',
        headers: {
          ContentType: 'application/json',
          accept: 'application/json',
        },
      }
    );

    const nfdJson = await nfdInfo.json();

    // Define Beth and Dave accounts in case we need to list the segment for sale
    const beth = await algorand.account.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }));
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));

    // Check the current state of the NFD, if it's not listed for sale, we'll list it
    if (nfdJson.state === 'owned') {
      // Beth is going to list the segment for sale using the NFD API /offer/{name}
      console.debug('NFD segment is not listed for sale, listing it now');
      const offerResp = await fetch(`https://api.testnet.nf.domains/nfd/offer/${nfdJson.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          offer: 100_000_000_000_000,
          payReceiver: false,
          reservedFor: dave.addr,
          sender: beth.addr,
        }),
      });

      // We should expect a 200 response
      expect(offerResp.status).toBe(200);

      // Extract the paired values from the response!
      // The escaped string paired values are in a 2d array, but we only care about the [0] index
      // as it holds our type and base64 encoded msgpack in [0][0] and [0][1] respectively
      const offerDataArr = JSON.parse(await offerResp.json());
      const type = offerDataArr[0][0];

      // We should expect an unsigned type and base64 encoded msgpack
      expect(type).toBe('u');

      // we can now continue with signing the base64 encoded msgpack
      const base64EncodedMsgPack = offerDataArr[0][1];

      // Decode the unsigned transaction
      const txn = decodeUnsignedTransaction(Buffer.from(base64EncodedMsgPack, 'base64'));

      // Sign the transaction
      const signedTxn = txn.signTxn(beth.account.sk);

      // Send the raw signed transaction
      const result = await algorand.client.algod.sendRawTransaction(signedTxn).do();
      expect(result.txId).toBeDefined();
      console.debug(`txnID on ${nfdJson.name} offer: `, result.txId);
    } else {
      console.debug(`${nfdJson.name} segment is already listed for sale`);
    } // end of listing the segment for sale

    // Prepare Beth for creating a listing for forsale.directory.algo
    algorand.setSignerFromAccount(beth);

    const bethTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: beth.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: beth.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    // Attempt to create a listing for forsale.directory.algo
    const t = async () => {
      try {
        await bethTypedClient.send.createListing({
          args: {
            collateralPayment: payTxn,
            nfdAppId: FORSALE_SEGMENT_APP_ID,
            listingTags: new Uint8Array(13),
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // the "opcodes=pop; !; assert" is the error message we are looking, verified by looking at the teal code
        if (e.message.includes('opcodes=pop; !; assert')) {
          throw new TypeError('NFD segment must not be listed for sale');
        } else {
          throw e;
        }
      }
    };
    // We expect the error message to be thrown
    await expect(t).rejects.toThrow('NFD segment must not be listed for sale');
    console.debug('NFD segment must not be listed for sale, expected error thrown!');
  });

  // Attempt to REFRESH a listing for an NFD the caller doesn't own; expect failure (BETH create listing and DAVE attempt to refresh it)
  test('daveRefreshesListingForBethAndFails', async () => {
    // Create a listing for beth.directory.algo
    const beth = await algorand.account.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(beth);

    const bethTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: beth.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: beth.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    const bethResult = await bethTypedClient.send.createListing({
      args: {
        collateralPayment: payTxn,
        nfdAppId: BETH_SEGMENT_APP_ID,
        listingTags: new Uint8Array(13),
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug('Create listing return: ', bethResult.return);

    expect(bethResult.confirmations?.length).toBe(2);
    expect(bethResult.confirmation?.confirmedRound).toBeGreaterThan(0);

    // Prepare a typed client for DAVE
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    // Dave is going to attempt to refresh beth's listing for beth.directory.algo, but will fail
    // on checkCallerIsListingOwner()
    const t = async () => {
      try {
        await daveTypedClient.send.refreshListing({
          args: {
            nfdAppId: BETH_SEGMENT_APP_ID,
          },
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.message.includes('opcodes=assert; ==; assert')) {
          throw new TypeError('Caller must be listing owner');
        } else {
          throw e;
        }
      } finally {
        // Beth is going to abandon her listing that dave tried to refresh even if the error thrown isnt
        // the one we expected
        const abandonResult = await bethTypedClient.send.abandonListing({
          args: {
            nfdAppId: BETH_SEGMENT_APP_ID,
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        expect(abandonResult.confirmations?.length).toBe(1);
        expect(abandonResult.confirmation?.confirmedRound).toBeGreaterThan(0);
        console.debug('Clean Up: Successfully abandoned listing for beth.directory.algo');
      }
    };
    await expect(t).rejects.toThrow('Caller must be listing owner');
    console.debug('Caller must be listing owner, expected error thrown!');
  });

  // Attempt to REFRESH a listing with expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)
  /** Need to figure out the expired NFD part first */

  // Attempt to REFRESH a listing for an NFD that is listed for sale; expect failure
  test('bethRefreshesListingWithForSaleSegment', async () => {
    // Beth has a listing for forsalewithlisting.directory.algo and will try to refresh it

    // We'll check to see if the segment has a directory listing first, and if it doesn't we'll create a listing
    // Setup beth and daves account in case we need to create a listing and/or put the segment for sale
    const beth = await algorand.account.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }));
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(beth);

    const bethTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: beth.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: beth.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    // Check if the segment has a directory listing
    try {
      // Check the directory listing for forsalewithlisting.directory.algo
      const encodedAppId = encodeUint64(FORSALE_WITH_LISTING_SEGMENT_APP_ID);
      await algorand.app.getBoxValue(deployedAppID, encodedAppId);
      throw new TypeError('Segment has a directory listing');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.message.includes('box not found')) {
        console.debug("Segment does not have a directory listing, let's create one");
        // Create a listing for forsalewithlisting.directory.algo
        const createResult = await bethTypedClient.send.createListing({
          args: {
            collateralPayment: payTxn,
            nfdAppId: FORSALE_WITH_LISTING_SEGMENT_APP_ID,
            listingTags: new Uint8Array(13),
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        console.debug('Create listing return: ', createResult.return);

        expect(createResult.confirmations?.length).toBe(2);
        expect(createResult.confirmation?.confirmedRound).toBeGreaterThan(0);
      } else {
        console.debug(`${FORSALE_WITH_LISTING_SEGMENT_APP_ID} app ID has a directory listing`);
      }
    } // end of checking if the segment has a directory listing

    // Check if the segment is listed for sale, if it's not listed for sale, we'll list it
    const nfdInfo = await fetch(
      `https://api.testnet.nf.domains/nfd/${FORSALE_WITH_LISTING_SEGMENT_APP_ID}?view=brief&poll=false&nocache=false`,
      {
        method: 'GET',
        headers: {
          ContentType: 'application/json',
          accept: 'application/json',
        },
      }
    );

    const nfdJson = await nfdInfo.json();

    console.debug('NFD segment state: ', nfdJson);

    // Check the current state of the NFD, if it's not listed for sale, we'll list it for sale
    if (nfdJson.state === 'owned') {
      console.debug('NFD segment is not listed for sale, listing it now');
      // Make an api call to the NFD endpoint to get an unsigned transaction to offer an NFD for sale
      const offerResp = await fetch(`https://api.testnet.nf.domains/nfd/offer/${nfdJson.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          offer: 100_000_000_000_000, // 100M ALGO
          payReceiver: false,
          reservedFor: dave.addr,
          sender: beth.addr,
        }),
      });

      expect(offerResp.status).toBe(200);

      // Extract the paired values from the response
      // The escaped string paired values are in a 2d array, but we only care about the [0] index
      // as it holds our type and base64 encoded msgpack in [0][0] and [0][1] respectively
      const offerDataArr = JSON.parse(await offerResp.json());
      const type = offerDataArr[0][0];

      // We should expect an unsigned type and base64 encoded msgpack
      expect(type).toBe('u');

      // we can now continue with signing the base64 encoded msgpack
      const base64EncodedMsgPack = offerDataArr[0][1];

      // Decode the unsigned transaction
      const txn = decodeUnsignedTransaction(Buffer.from(base64EncodedMsgPack, 'base64'));

      // Sign the transaction
      const signedTxn = txn.signTxn(beth.account.sk);

      // Send the raw signed transaction
      const result = await algorand.client.algod.sendRawTransaction(signedTxn).do();
      console.debug(`txnID on ${nfdJson.name} offer: `, result.txId);
    } else {
      console.debug(`${nfdJson.name} segment is already listed for sale`);
    } // end of listing the segment for sale

    // Have Beth refresh the listing for forsalewithlisting.directory.algo
    const t = async () => {
      try {
        await bethTypedClient.send.refreshListing({
          args: {
            nfdAppId: FORSALE_WITH_LISTING_SEGMENT_APP_ID,
          },
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.message.includes('opcodes=pop; !; assert')) {
          throw new TypeError('NFD segment must not be listed for sale');
        } else throw e;
      }
    };
    // We expect an error message to be thrown
    await expect(t).rejects.toThrow('NFD segment must not be listed for sale');
    console.debug('NFD segment must not be listed for sale, expected error thrown!');
  });

  // Attempt to ABANDON a listing that the caller doesn't own; expect failure (BETH create listing and DAVE attempt to abandon it)
  test('daveAbandonsListingForBethAndFails', async () => {
    // Create a listing for beth.directory.algo
    const beth = await algorand.account.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(beth);

    const bethTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: beth.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: beth.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    const bethResult = await bethTypedClient.send.createListing({
      args: {
        collateralPayment: payTxn,
        nfdAppId: BETH_SEGMENT_APP_ID,
        listingTags: new Uint8Array(13),
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug('Create listing return: ', bethResult.return);

    expect(bethResult.confirmations?.length).toBe(2);
    expect(bethResult.confirmation?.confirmedRound).toBeGreaterThan(0);

    // Prepare a typed client for DAVE
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });

    // Dave is going to attempt to abandon beth's listing for beth.directory.algo, but will fail
    // on checkCallerIsListingOwner()
    const t = async () => {
      try {
        await daveTypedClient.send.abandonListing({
          args: {
            nfdAppId: BETH_SEGMENT_APP_ID,
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.message.includes('opcodes=assert; ==; assert')) {
          throw new TypeError('Caller must be listing owner');
        } else throw e;
      } finally {
        // Beth is going to abandon her listing that dave tried to abandon even if the error thrown isnt
        // the one we expected
        const abandonResult = await bethTypedClient.send.abandonListing({
          args: {
            nfdAppId: BETH_SEGMENT_APP_ID,
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        expect(abandonResult.confirmations?.length).toBe(1);
        expect(abandonResult.confirmation?.confirmedRound).toBeGreaterThan(0);
        console.debug('Clean Up: Successfully abandoned listing for beth.directory.algo');
      }
    };
    await expect(t).rejects.toThrow('Caller must be listing owner');
    console.debug('Caller must be listing owner, expected error thrown!');
  });

  // Attempt to DELETE a listing without having the admin token; expect failure (BETH create listing and DAVE attempt to delete it)
  test('bethCreatesListingThenDaveAttemptsDelete', async () => {
    // Step 1: Beth is going to create a listing for beth.directory.algo
    const beth = await algorand.account.fromEnvironment(BETH, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(beth);
    const bethTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: beth.addr,
    });

    const payTxn = await algorand.transactions.payment({
      sender: beth.addr,
      receiver: deployedAppAddress,
      amount: (72200).microAlgo(), // Each listing 72_200 uA
    });

    const createResult = await bethTypedClient.send.createListing({
      args: {
        collateralPayment: payTxn,
        nfdAppId: BETH_SEGMENT_APP_ID,
        listingTags: new Uint8Array(13),
      },
      extraFee: (1000).microAlgo(),
      populateAppCallResources: true,
    });
    console.debug('Create listing return: ', createResult.return);

    expect(createResult.confirmations?.length).toBe(2);
    expect(createResult.confirmation?.confirmedRound).toBeGreaterThan(0);

    // Step 2: Dave is now going to attempt to delete Beth's listing for beth.directory.algo and we expect an error/failure
    const dave = await algorand.account.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }));
    algorand.setSignerFromAccount(dave);
    const daveTypedClient = algorand.client.getTypedAppClientById(AlgoDirectoryClient, {
      appId: deployedAppID,
      defaultSender: dave.addr,
    });
    const t = async () => {
      try {
        await daveTypedClient.send.deleteListing({
          args: {
            nfdAppId: BETH_SEGMENT_APP_ID,
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.message.includes('opcodes=intc_1 // 0; >; assert')) {
          throw new TypeError('Caller must have the admin token');
        } else {
          throw e;
        }
      } finally {
        // Beth is going to abandon her listing that dave tried to delete even if the error thrown isnt
        // the one we expected, clean up the listing
        const abandonResult = await bethTypedClient.send.abandonListing({
          args: {
            nfdAppId: BETH_SEGMENT_APP_ID,
          },
          extraFee: (1000).microAlgo(),
          populateAppCallResources: true,
        });
        expect(abandonResult.confirmations?.length).toBe(1);
        expect(abandonResult.confirmation?.confirmedRound).toBeGreaterThan(0);
        console.debug('Clean Up: Successfully abandoned listing for beth.directory.algo');
      }
    };
    // Expect the error message to be thrown
    await expect(t).rejects.toThrow('Caller must have the admin token');
    console.debug('Caller must have the admin token, expected error thrown!');
  });

  // If an NFD has expired, let the new owner abandon the old listing and refund the original listing owner
});
