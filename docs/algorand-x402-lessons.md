# x402 on Algorand: lessons learned

What we ran into shipping a paid x402 agent on Algorand MainNet with the GoPlausible facilitator. Every item below was hit or measured on live infrastructure in September 2026, with `@x402/*` 2.25.0 and `@algorandfoundation/algokit-utils` 10.0.0-alpha.46.

## 1. Network ids: advertise the full genesis hash

GoPlausible's `/supported` lists Algorand networks by their **full** CAIP-2 genesis-hash id:

- MainNet `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=`
- TestNet `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`

`@x402/avm` exports truncated constants that the facilitator rejects.

- **Servers:** put the full id in `accepts[].network`.
- **Clients:** register `"algorand:*"` so the scheme matches whichever form a server advertises.

## 2. Payment validity window vs charge-on-success

`@x402/avm` builds the payment group with algokit-utils' default validity window of **10 rounds (about 30 s)** and never extends it, whatever `maxTimeoutSeconds` the server advertises. On EVM, the EIP-3009 authorization follows `maxTimeoutSeconds`, so this is Algorand-specific.

If the server settles **after** running the paid work, any run longer than about 25 s can't be settled. Our first MainNet call hit exactly this: `txn dead: round 65104591 outside of 65104580--65104590`. The caller wasn't charged, but they got no result either.

Clients can widen the window without code changes on the server:

```ts
const algorandClient = AlgorandClient.mainNet().setDefaultValidityWindow(20); // ~60 s
client.register('algorand:*', new ExactAvmScheme(signer, { algorandClient }));
```

With 20 rounds, 25 of 25 consecutive MainNet paid calls settled (11.6–25.1 s each). We kept charge-on-success and document the wider window for buyers.

## 3. 402-first, for every kind of probe

Crawlers, indexers and GoPlausible's **x402 Doctor** check pricing with unpaid requests that are body-less, `{}` or otherwise not JSON-RPC. Returning `400 Invalid Request` to those fails the Doctor's "Responds 402 to unpaid requests" check and hides your price.

Return the 402 challenge to **any unpaid request**, and keep request-shape errors for callers that actually attached a payment.

## 4. The Bazaar listing keeps its first example

GoPlausible validates the Bazaar extension by compiling `extension.schema` and checking `extension.info` against it. For AVM, `schema` must therefore describe the whole `info` envelope, not just your input object.

The listing's example request is captured when your **first** payment settles. Later settles and the dashboard's "Refresh metadata" updated merchant metadata but did not replace the example body we had already published (observed 2026-09-16). **Get the advertised example right before the first MainNet settlement.**

For an A2A endpoint, the example should carry the real input fields as a `data` part, not a placeholder `text` part.

## 5. Merchant enrichment reads the root of your domain

The facilitator enriches your merchant page from the **root** of the domain your paid endpoint lives on:

- OpenGraph tags on `/`
- `/.well-known/x402`
- `/.well-known/agent-card.json` and `/.well-known/agent.json` (`name`, `description`)
- `/llms.txt` (the first `#` heading becomes the name)

Our router originally sent those paths to the agent handler, which returned 400. A single-page-app catch-all that answers `index.html` counts as "file absent" too.

Keep one payTo per root domain, and list only that domain's own endpoints in `/.well-known/x402`.

## 6. An NFD name needs a *verified* address

An NFD shows up as your merchant name only if the payTo is a **verified** address on the NFD. Owning the NFD with that address isn't enough.

- Before linking, `api.nf.domains/nfd/lookup?address=<payTo>` returned 404.
- After adding the address under Edit → Addresses → Verified, it resolved. The NFD API kept serving the cached 404 for a while.

## 7. Key derivation footgun

`ed25519SigningKeyFromWrappedSecret` (algokit-utils) **zeroes the seed buffer** after deriving the key. If you then build the `seed || pubkey` string for `toClientAvmSigner` from that same buffer, you get the key of the well-known all-zeros account. The signatures are valid, so nothing errors; the payments just come from someone else's public account. Copy the seed first:

```ts
const seed = seedFromMnemonic(mnemonic);
const seedCopy = new Uint8Array(seed);
const key = await ed25519SigningKeyFromWrappedSecret({ unwrapEd25519Seed: async () => seed, wrapEd25519Seed: async () => {} });
const privateKeyBase64 = Buffer.concat([Buffer.from(seedCopy), Buffer.from(key.ed25519Pubkey)]).toString('base64');
```

## 8. Success rate counts failed settlements

The GoPlausible dashboard's "x402 Success rate" includes settlement attempts that failed. Two early timeouts (lesson 2) left us at 40% after five attempts. After we switched our own test buyer to the wider window, 25 straight successful calls brought the rate to about 90%.

## 9. Latency budget

On a typical paid call:

| Step | Time |
|---|---|
| Facilitator verify | ~0.1 s |
| Facilitator settle | ~5 s |
| LLM step | 6–11 s |

Nodely's indexer `currency-greater-than` holder query takes a flat ~5 s on assets with huge holder sets (USDC, USDt) whatever the threshold. With `limit=10` it timed out (HTTP 500 at 10 s), while `limit=100` came back in ~5 s. We cache that result per asset.

## 10. Funding a test account

- USDC is an ASA, so the account must **opt in** (0.1 ALGO minimum balance plus a fee) before it can receive it.
- Fund ALGO first, confirm the opt-in, then request USDC from the [Circle faucet](https://faucet.circle.com) (Algorand TestNet, 20 USDC per request, rate-limited per address).
- Vestige endpoints are MainNet-only, so price, history and pool data can't be tested on TestNet.
