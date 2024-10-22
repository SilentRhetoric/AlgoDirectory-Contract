import { Contract } from '@algorandfoundation/tealscript';

type Listing = {
  timestamp: uint64; // 8 bytes
  vouchAmount: uint64; // 8 bytes
  nfdAppID: AppID; // 8 bytes
  tags: StaticArray<byte, 13>; // 13 bytes, each representing one of 255 possible tags
  name: string; // NFD names are up to 27 characters
}; // 64 bytes total

const LISTED_NFD_APP_ID_BOX_COST = 31300; // 2500 + (400 * (8 + 64))
const LISTING_BOX_COST = 40900; // 2500 + (400 * (64 + 32))
const TOTAL_LISTING_BOXES_COST = LISTED_NFD_APP_ID_BOX_COST + LISTING_BOX_COST;

/**
 * A singleton-pattern smart contract that stores metadata and collateral for
 * all listings created for segments of the directory.algo NFD. A listing can be
 * created, refreshed, and abandoned by its owner,
 * removed by anyone if the underlying NFD was sold,
 * or deleted by an administrator with a penalty if it is inappropriate.
 */
export class AlgoDirectory extends Contract {
  // Testnet A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE
  // Mainnet Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA
  feeSinkAddress = TemplateVar<Address>();

  directoryAppID = TemplateVar<AppID>(); // Testnet 576232821 / Mainnet 766401564

  nfdRegistryAppID = TemplateVar<AppID>(); // Testnet 84366825 / Mainnet 760937186

  adminToken = GlobalStateKey<AssetID>(); // The ASA ID of the token which gates the ability to delete listings

  listedNFDappIDs = BoxMap<AppID, Listing>(); // 8 byte key + 0 byte value =  8 bytes total

  listings = BoxMap<Listing, Address>(); // 64 byte key + 32 byte value = 96 bytes total

  private checkCallerIsListingOwner(nfdAppID: AppID): void {
    const listingKey = this.listedNFDappIDs(nfdAppID).value;
    assert(this.txn.sender === this.listings(listingKey).value, 'Caller must be listing owner');
  }

  private checkNFDIsSegmentOfDirectory(nfdAppID: AppID): void {
    // Ensure the NFD is a segment of directory.algo by checking the parent appID
    assert(
      btoi(nfdAppID.globalState('i.parentAppID') as bytes) === this.directoryAppID.id,
      'NFD must be a segment of directory.algo'
    );
  }

  private checkCallerIsNFDOwner(nfdAppID: AppID): void {
    // Check in the NFD instance app that the sender is the owner of the NFD
    assert(
      this.txn.sender === (nfdAppID.globalState('i.owner.a') as Address),
      'Listing creator must be the NFD app i.owner.a'
    );
  }

  private checkNFDOwnerIsNotListingOwner(nfdAppID: AppID): void {
    // Get the address of the listing owner
    const listingKey = this.listedNFDappIDs(nfdAppID).value;
    const listingOwner = this.listings(listingKey).value;
    // Get the address of the NFD owner
    const nfdOwner = nfdAppID.globalState('i.owner.a') as Address;
    // Ensure the NFD owner is not the listing owner, and thus the NFD has been transferred
    assert(nfdOwner !== listingOwner, 'NFD owner must be different than the listing owner');
  }

  private checkNFDNotExpired(nfdAppID: AppID): void {
    // Check that the segment is current and not expired
    // Because directory.algo is V3, there are no lifetime ownership segments
    assert(
      globals.latestTimestamp <= btoi(nfdAppID.globalState('i.expirationTime') as bytes),
      'NFD segment must not be expired'
    );
  }

  private checkNFDNotForSale(nfdAppID: AppID): void {
    // Check that the segment is not listed for sale, which wipes properties and
    // would essentially invalidate a Directory listing
    assert(!nfdAppID.globalStateExists('i.sellamt'), 'NFD segment must not be listed for sale');
  }

  private getRoundedTimestamp(): uint64 {
    return btoi(replace3(itob(globals.latestTimestamp), 7, bzero(1)));
  }

  /**
   * Defines an ARC-28 event to be emitted by the createListing method that
   * contains the listing which was created for an NFD segment of directory.algo
   */
  CreateListingEvent = new EventLogger<{
    listing: Listing;
  }>();

  /**
   * Creates a listing in the directory by vouching for an NFD root or segment of directory.algo
   *
   * @param collateralPayment The Algo payment transaction of collateral to vouch for the listing
   * @param nfdAppID The Application ID of the NFD that will be listed
   * @param listingTags An array of 13 bytes with each representing a tag for the listing
   */
  createListing(collateralPayment: PayTxn, nfdAppID: AppID, listingTags: StaticArray<byte, 13>): Listing {
    // Check that the caller is paying a mimimum amount of collateral to vouch for the listing
    verifyPayTxn(collateralPayment, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: { greaterThanEqualTo: TOTAL_LISTING_BOXES_COST },
    });

    // Ensure the NFD is a directory.algo segment, the caller owns it, and it is not expired
    this.checkNFDIsSegmentOfDirectory(nfdAppID);
    this.checkCallerIsNFDOwner(nfdAppID);
    this.checkNFDNotExpired(nfdAppID);
    this.checkNFDNotForSale(nfdAppID);

    // Check in the NFD registry that this is a valid NFD app ID (not a fake NFD)
    const nfdLongName = nfdAppID.globalState('i.name') as bytes;

    sendAppCall({
      applicationID: this.nfdRegistryAppID,
      applicationArgs: ['is_valid_nfd_appid', nfdLongName, itob(nfdAppID)],
      fee: 0,
    });
    assert(btoi(this.itxn.lastLog) === 1, 'NFD app ID must be valid at the NFD registry');

    // Check that a directory listing for this NFD App ID does not already exist
    assert(!this.listedNFDappIDs(nfdAppID).exists, 'Listing for this NFD must not already exist');

    // The NFD name needs to have directory.algo trimmed off the end & padded to 27 bytes
    const nfdSegmentName = substring3(nfdLongName, 0, len(nfdLongName) - 15);

    const listingKey: Listing = {
      timestamp: this.getRoundedTimestamp(), // Round the timestamp
      vouchAmount: collateralPayment.amount,
      nfdAppID: nfdAppID,
      tags: listingTags,
      name: nfdSegmentName,
    };

    // Create the listing in the directory
    this.listings(listingKey).value = this.txn.sender;

    // Map the NFD App ID to the listing key
    this.listedNFDappIDs(nfdAppID).value = listingKey;

    // Emit an ARC-28 event for the subscriber to pick up
    this.CreateListingEvent.log({
      listing: listingKey,
    });

    // TODO: This return value can be removed once tests are updated to read ARC-28 events
    return listingKey;
  }

  /**
   * Defines an ARC-28 event to be emitted by the refreshListing method that
   * contains the listing which was refreshed
   */ RefreshListingEvent = new EventLogger<{
    listing: Listing;
  }>();

  /**
   * Refreshes a listing in the directory and updates its last touched timestamp
   *
   * @param nfdAppID The Application ID of the NFD that will be refreshed
   * @param listingTags An array of 13 bytes with each representing a tag.
   *  Used to update the tags of the listing, if no tags are to be updated, pass the existing tags
   *
   */
  refreshListing(nfdAppID: AppID, listingTags: StaticArray<byte, 13>): Listing {
    // Ensure the caller owns this listing, owns the NFD, and the NFD has not expired.
    // Note that if the NFD has been transferred, the new owner will not be able to
    // refresh as they will not be both the current NFD owner and the original listing owner.
    // The new owner of a transferred NFD must abandon the old listing and create a new one
    // with their own collateral.
    this.checkCallerIsListingOwner(nfdAppID);
    this.checkCallerIsNFDOwner(nfdAppID);
    this.checkNFDNotExpired(nfdAppID);
    this.checkNFDNotForSale(nfdAppID);

    // The new listing box will be swapped for one with a new timestamp in the key struct
    const oldListingKey = this.listedNFDappIDs(nfdAppID).value;
    const newListingKey: Listing = {
      timestamp: this.getRoundedTimestamp(), // Round the timestamp
      vouchAmount: oldListingKey.vouchAmount,
      nfdAppID: oldListingKey.nfdAppID,
      tags: listingTags,
      name: oldListingKey.name,
    };

    // Remove the old listing box
    this.listings(oldListingKey).delete();

    // Create the new, refreshed listing box (may be the same if not much time has passed)
    this.listings(newListingKey).value = this.txn.sender;

    // Map the new listing to the NFD App ID
    this.listedNFDappIDs(nfdAppID).value = newListingKey;

    // Emit an ARC-28 event for the subscriber to pick up
    this.RefreshListingEvent.log({
      listing: newListingKey,
    });

    return newListingKey;
  }

  /**
   * Defines an ARC-28 event to be emitted by the abandonListing method that
   * contains the listing which was abandoned
   */ AbandonListingEvent = new EventLogger<{
    listing: Listing;
  }>();

  /**
   * Abandons a listing in the directory and returns the vouched collateral
   *
   * @param nfdAppID The Application ID of the NFD that will be abandoned
   */
  abandonListing(nfdAppID: AppID): void {
    const listingKey = this.listedNFDappIDs(nfdAppID).value;

    // Check that the caller is the owner of the NFD
    // The caller need not be the listing owner in case they purchased the NFD
    // from a previous owner who created the listing
    this.checkCallerIsNFDOwner(nfdAppID);

    // Return the vouched collateral to the original listing owner
    sendPayment({
      sender: this.app.address,
      receiver: this.listings(listingKey).value,
      amount: listingKey.vouchAmount,
      fee: 0,
    });

    // Emit an ARC-28 event for the subscriber to pick up
    this.AbandonListingEvent.log({
      listing: listingKey,
    });

    // Remove both boxes for the listing: the NFD App ID and the listing itself
    this.listings(listingKey).delete();
    this.listedNFDappIDs(nfdAppID).delete();
  }

  /**
   * Defines an ARC-28 event to be emitted by the removeTransferredListing method that
   * contains the listing which was removed after the NFD was transferred
   */ RemoveTransferredListingEvent = new EventLogger<{
    listing: Listing;
  }>();

  /**
   * Removes a listing for which the NFD has been transferred.
   * Anyone can call this to clean up a listing that is no longer valid.
   *
   * @param nfdAppID The Application ID of the NFD that will be removed
   */
  removeTransferredListing(nfdAppID: AppID): void {
    const listingKey = this.listedNFDappIDs(nfdAppID).value;

    // Check that the NFD has changed hands
    this.checkNFDOwnerIsNotListingOwner(nfdAppID);

    // Return the vouched collateral to the original listing owner
    sendPayment({
      sender: this.app.address,
      receiver: this.listings(listingKey).value,
      amount: listingKey.vouchAmount,
      fee: 0,
    });

    // Emit an ARC-28 event for the subscriber to pick up
    this.RemoveTransferredListingEvent.log({
      listing: listingKey,
    });

    // Remove both boxes for the listing: the NFD App ID and the listing itself
    this.listings(listingKey).delete();
    this.listedNFDappIDs(nfdAppID).delete();
  }

  /**
   * Defines an ARC-28 event to be emitted by the deleteListing method that
   * contains the listing which was deleted by an admin for inappropriate content
   */ DeleteListingEvent = new EventLogger<{
    listing: Listing;
  }>();

  /**
   * Deletes a listing from the directory & sends the collateral to the fee sink
   *
   * @param nfdAppID The Application ID of the NFD that will be deleted
   */
  deleteListingWithPenalty(nfdAppID: AppID): string {
    // This method is restricted to only holders of the admin asset
    assert(this.txn.sender.assetBalance(this.adminToken.value) > 0, 'Caller must have the admin token');

    const listingKey = this.listedNFDappIDs(nfdAppID).value;
    const deleteNote = 'Yeeted ' + listingKey.name + ' to the fee sink';

    // Yeet the vouched collateral into the fee sink as punishment
    sendPayment({
      sender: this.app.address,
      receiver: this.feeSinkAddress,
      amount: listingKey.vouchAmount,
      fee: 0,
      note: deleteNote,
    });

    // Emit an ARC-28 event for the subscriber to pick up
    this.DeleteListingEvent.log({
      listing: listingKey,
    });

    // Remove both boxes for the listing
    this.listings(listingKey).delete();
    this.listedNFDappIDs(nfdAppID).delete();

    return deleteNote;
  }

  /**
   * Stores an ASA ID in global state that will control administration rights
   *
   * @param asaID The Asset ID of the ASA to be the admin token
   */
  setAdminToken(asaID: AssetID): void {
    assert(this.txn.sender === this.app.creator, 'Only the creator can set the admin token');
    this.adminToken.value = asaID;
  }

  /**
   * Enables the application to be updated by the creator
   *
   */
  updateApplication(): void {
    assert(this.txn.sender === this.app.creator, 'Only the creator can update the application');
  }

  createApplication(): void {}
}
