# Using ATProto Identities On XMTP

Developers building with [ATProto](https://atproto.com) (the protocol powering Bluesky) have been asking how they can use XMTP to power messaging between users in their apps. It’s possible today to add secure messaging to any Bluesky app, and to add Bluesky identity to any messenger built on XMTP.

## Linking Identities

To make an ATProto messenger on XMTP, we need to link together two different identity systems.

1. [ATProto identities](https://atproto.com/guides/identity), represented by a [DID](https://atproto.com/specs/did)
2. [XMTP Inboxes](https://xmtp.org/identity), represented by an Inbox ID

We need to bind these two identities together so that when you want to reach a handle on your ATProto app you know which XMTP identity to talk to, and when you receive a message from an XMTP Inbox you can look up the DID and profile.

To make that happen securely we want a **two-way confirmation** proving that the XMTP Inbox wants to be associated with a particular DID, and that the DID owner approves connecting to an XMTP Inbox. 

We can get that confirmation by having your XMTP account sign a message that includes the DID, and then by storing the XMTP Inbox ID and the signature in the DID’s signed [data repository](https://atproto.com/guides/data-repos) as a record.

## Step 1: Associate an XMTP Inbox with a DID

To start, you’ll need to create an XMTP client. You can generate the keys randomly.

```jsx
import { Client } from "@xmtp/node-sdk";
import { createSigner, createUser } from "@xmtp/agent-sdk";

// This will generate a random keypair
const user = createUser(); // Store `user.key` somewhere safe

// Create an XMTP client
const client = await Client.create(createSigner(user), {
  env: "dev", // you'll want to use "production" for your real app
  dbPath: "my-db.db3"
});

// We will need this later
const inboxId = client.inboxId
```

Now you need to create a signature that proves that this XMTP account wants to be connected to a particular DID.

```jsx
// Sign a message with the XMTP client's keys approving the DID
const signatureBytes = client.signWithInstallationKey("yourATProtoDID"); // Your app may want to put more information in the signature text, but this will do.
const signatureString = Buffer.from(signatureBytes).toString("base64")
```

## Step 2: Tell ATProto About Your XMTP Inbox

Now that we have an XMTP inbox

```jsx
import { AtpAgent } from "@atproto/api";

const agent = new AtpAgent({
  service: "https://bsky.social", // or your own PDS
});

await agent.login({
  identifier: 'you.bsky.social',
  password: 'your-app-password',
});

await agent.com.atproto.repo.putRecord({
    repo: agent.session.did,
    collection: "org.xmtp.inbox",
    rkey: "self",
    record: {
      id: inboxID, // Get this from `xmtpclient.inboxId`
      verificationSignature: verificationSignature, // `signatureString` from step 1
      createdAt: new Date().toISOString(),
    },
  });
```

## Step 3: Resolution

Going from an ATProto handle or DID to an Inbox ID is straightforward. You can look up the Inbox ID and signature that you stored in the ATProto repo and verify the signature using the XMTP Node SDK.

```jsx
const verifySignature = async (
  inboxId: string,
  did: string,
  verificationSignature: string,
) => {
  const [inboxState] = await Client.fetchInboxStates([inboxId], XMTP_ENV);
  const signatureBytes = Buffer.from(verificationSignature, "base64");

  for (const installation of inboxState.installations) {
    if (
      Client.verifySignedWithPublicKey(
        did,
        signatureBytes,
        installation.bytes,
      )
    ) {
      return true;
    }
  }

  return false;
};

const didToVerify = (await agent.resolveHandle({ handle: "somehandle.bsky.social" })).data.did

const {
  data: { value: { inboxId, verificationSignature } },
} = await agent.com.atproto.repo.getRecord({
  repo: didToVerify,
  collection: "org.xmtp.inbox",
  rkey: "self",
});

const associationIsValid = await verifySignature(inboxId, did, verificationSignature)
```

But you’re also going to want to resolve XMTP Inbox ID → DID. This is important when your users receive a new message from a stranger or get added to a group chat. You want to be able to show everyone’s name and profile photo starting from an XMTP Inbox ID.

For a single app, the easiest solution is to run a server that gets notified when someone creates a `DID <> Inbox ID` connection. The server would verify everything like above and store the mapping in both directions. Clients could query the server with an Inbox ID and check to see if there is a linked ATProto identity (clients don’t have to trust the server since they can verify the association themselves).

A more interoperable and ATProto native solution is to run an [AppView](https://atproto.com/guides/glossary#app-view) or [Relay](https://atproto.com/guides/glossary#relay) that indexes every single user in the Atmosphere and builds the mapping globally.

## A more complete example

```jsx
/**
 * Links an XMTP inbox to a Bluesky identity using the AT Protocol.
 *
 * Flow:
 *  1. Authenticate with Bluesky to obtain a session DID.
 *  2. Create an XMTP client and sign the DID with its installation key.
 *  3. Publish the XMTP inbox ID + signature as an AT Protocol record
 *     in the `org.xmtp.inbox` collection on the user's PDS.
 *  4. Read the record back from the PDS.
 *  5. Verify the signature against XMTP's network to confirm the
 *     association is valid.
 */

import { AtpAgent } from "@atproto/api";
import { Client } from "@xmtp/node-sdk";
import { createSigner, createUser } from "@xmtp/agent-sdk";

// ── Configuration ──────────────────────────────────────────────────────

const BLUESKY_USER = process.env.BLUESKY_USER || "my-bluesky-username";
const BLUESKY_PASSWORD = process.env.BLUESKY_PASSWORD || "my-bluesky-password";
const XMTP_ENV = "dev";
const XMTP_DB_PATH = "my-db.db3";
const XMTP_PRIVATE_KEY =
  (process.env.XMTP_KEY as `0x${string}`) || "0xPrivateKey";

/** The AT Protocol collection where XMTP inbox records are stored. */
const INBOX_COLLECTION = "org.xmtp.inbox";

// ── Bluesky Client ────────────────────────────────────────────────────

const agent = new AtpAgent({
  service: "https://bsky.social", // or your own PDS
});

// ── Helper Functions ──────────────────────────────────────────────────

/**
 * Create an XMTP client and produce a signature proving ownership of this
 * XMTP inbox for the authenticated Bluesky DID.
 *
 * The signature is created with the XMTP installation key so it can later
 * be verified by anyone who fetches the inbox state from the XMTP network.
 */
const getXmtpVerificationInfo = async (did: string) => {
  const user = createUser(XMTP_PRIVATE_KEY);
  const client = await Client.create(createSigner(user), {
    env: XMTP_ENV,
    dbPath: XMTP_DB_PATH,
  });

  const signatureBytes = client.signWithInstallationKey(did);
  const verificationSignature = Buffer.from(signatureBytes).toString("base64");

  return { inboxId: client.inboxId, verificationSignature };
};

/**
 * Write an `org.xmtp.inbox` record to the authenticated user's PDS,
 * associating their Bluesky DID with an XMTP inbox.
 */
const associateInboxToBluesky = async (
  inboxId: string,
  verificationSignature: string,
) => {
  await agent.com.atproto.repo.putRecord({
    repo: agent.session!.did,
    collection: INBOX_COLLECTION,
    rkey: "self",
    record: {
      id: inboxId,
      verificationSignature,
      createdAt: new Date().toISOString(),
    },
  });
};

/**
 * Fetch the `org.xmtp.inbox` record for a given DID from its PDS.
 */
const lookupInboxForDid = async (did: string) => {
  const {
    data: { value },
  } = await agent.com.atproto.repo.getRecord({
    repo: did,
    collection: INBOX_COLLECTION,
    rkey: "self",
  });

  return value;
};

/**
 * Verify that a verification signature was actually produced by one of the
 * installation keys associated with the given XMTP inbox.
 *
 * This confirms the inbox truly belongs to the claimed DID, preventing
 * someone from publishing a forged `org.xmtp.inbox` record.
 */
const verifySignature = async (
  inboxId: string,
  did: string,
  verificationSignature: string,
) => {
  const [inboxState] = await Client.fetchInboxStates([inboxId], XMTP_ENV);

  for (const installation of inboxState.installations) {
    if (
      Client.verifySignedWithPublicKey(
        did,
        Buffer.from(verificationSignature, "base64"),
        installation.bytes,
      )
    ) {
      return true;
    }
  }

  return false;
};

// ── Main ──────────────────────────────────────────────────────────────

// Step 1: Authenticate with Bluesky to start a session
await agent.login({
  identifier: BLUESKY_USER,
  password: BLUESKY_PASSWORD,
});

const did = agent.session!.did;

// Step 2: Sign the Bluesky DID with the XMTP installation key
const { inboxId, verificationSignature } = await getXmtpVerificationInfo(
  agent.session!.did,
);

// Step 3: Publish the inbox record to the user's PDS
await associateInboxToBluesky(inboxId, verificationSignature);

// Step 4: Read the record back from the PDS
const result: any = await lookupInboxForDid(did);
console.log(result);

// Step 5: Verify the signature to confirm the association is legitimate
const isValid = await verifySignature(
  result.id,
  did,
  result.verificationSignature,
);

console.log(
  `Verification for the mapping between XMTP Inbox ${inboxId} and Bluesky DID ${did} is ${isValid ? "passed" : "failed"}`,
);

```